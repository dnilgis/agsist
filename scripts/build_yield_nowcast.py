#!/usr/bin/env python3
"""build_yield_nowcast.py — the AGSIST Yield Nowcast.

WHAT: a weekly national corn + soybean yield estimate built from Monday's
USDA Crop Progress ratings, with an honest error band earned by backtest.
Nobody publishes this weekly with a public track record; USDA's first
survey-based forecast waits until mid-August.

MODEL (deliberately simple, fully auditable — "computed, not asserted"):
  For each fitted state at the current ISO week:
    1. OLS yield trend on year (final state yields, 2010+).
    2. OLS of yield DEVIATION-from-trend on that week's G+E share,
       using the same-week history in data/conditions/conditions.json.
    3. This year's G+E -> state yield estimate.
  States aggregate to a planted-acre-weighted average, then a ratio
  calibration k = mean(US_actual / state_agg) maps the 18-state panel to
  the 50-state national number.

HONESTY RULES:
  - The error band is NOT a formula prior: it is the 80th percentile of
    absolute LEAVE-ONE-YEAR-OUT errors at THIS week, recomputed every run.
    Early-season bands are wide because early-season calls were wrong.
  - The trend-only MAE ships alongside so the reader sees the skill,
    not just the number.
  - Every weekly nowcast is appended to history and never edited; the
    final USDA yield gets written next to them in January. Misses stay.
  - Off-season / stale ratings (>21 days): the script refuses to write
    a new nowcast (exit 0) — the page keeps showing the last dated one.
  - Under 10 states or under 12 backtest years: exit 1 (fail loud).

Inputs (all repo-local, refreshed by their own workflows):
  data/cond-yield/pairs.json        PREFERRED history: 2000+ same-week
                                    (year, ge, yield) pairs, emitted weekly by
                                    fetch_cond_yield.py in Actions. Used only
                                    when its ISO week matches the current
                                    ratings week; otherwise falls back to:
  data/conditions/conditions.json   current-week G+E + same-week history
  data/nass/{corn,soy}-yield.json   state final yields
  data/nass/{corn,soy}-acres.json   state planted acres (weights)
  data/nass/{corn,soy}-yield-us.json  national final yields
Output:
  data/yield-nowcast.json           latest nowcast + backtest + history

Usage: python3 scripts/build_yield_nowcast.py [--selftest] [--force-stale]
"""
import json
import sys
from datetime import datetime, timezone, date

OUT = "data/yield-nowcast.json"
MIN_STATES = 10
MIN_YEARS = 12
STALE_DAYS = 21

ST_ABBR = {
    'Alabama': 'AL', 'Arkansas': 'AR', 'Colorado': 'CO', 'Connecticut': 'CT',
    'Delaware': 'DE', 'Georgia': 'GA', 'Illinois': 'IL', 'Indiana': 'IN',
    'Iowa': 'IA', 'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA',
    'Maryland': 'MD', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Nebraska': 'NE', 'New York': 'NY', 'North Carolina': 'NC',
    'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK', 'Pennsylvania': 'PA',
    'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN',
    'Texas': 'TX', 'Virginia': 'VA', 'Wisconsin': 'WI',
}

CROPS = {
    "corn": ("corn-yield.json", "corn-acres.json", "corn-yield-us.json"),
    "soybeans": ("soy-yield.json", "soy-acres.json", "soy-yield-us.json"),
}


def linfit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx if sxx else 0.0
    return my - b * mx, b


def state_estimate(pairs, target_year, ge_now):
    """pairs: [(year, ge, yield)] -> model estimate for target_year at ge_now."""
    yrs = [p[0] for p in pairs]
    ges = [p[1] for p in pairs]
    vals = [p[2] for p in pairs]
    ta, tb = linfit(yrs, vals)
    dev = [v - (ta + tb * y) for y, g, v in pairs]
    da, db = linfit(ges, dev)
    return ta + tb * target_year + da + db * ge_now


def load_pairs_panel(crop, cond_week_ending, yrows, arows):
    """2000+ panel from pairs.json when fresh (same ISO week as the current
    ratings). Returns None to trigger the 2010+ local fallback."""
    try:
        p = json.load(open("data/cond-yield/pairs.json"))["crops"][crop]
    except (FileNotFoundError, KeyError, ValueError):
        return None
    iso_wk = date.fromisoformat(cond_week_ending).isocalendar()[1]
    if p.get("week") != iso_wk:
        return None
    panel = {}
    for s, rows in p["states"].items():
        if s not in yrows or s not in arows:
            continue
        pairs = [(int(y), float(g), float(v)) for y, g, v in rows]
        if len(pairs) >= MIN_YEARS:
            panel[s] = sorted(pairs)
    return panel if len(panel) >= MIN_STATES else None


def build_panel(cond_states, yrows, arows, fit_states):
    panel = {}
    for s in fit_states:
        if s not in yrows or s not in arows or s not in cond_states:
            continue
        hist = dict(cond_states[s].get("hist") or [])
        pairs = []
        for ystr, v in yrows[s].items():
            y = int(ystr)
            g = hist.get(y)
            if g is not None and v is not None:
                pairs.append((y, float(g), float(v)))
        pairs.sort()
        if len(pairs) >= MIN_YEARS:
            panel[s] = pairs
    return panel


def aggregate(panel, arows, year, per_state_value):
    num = den = 0.0
    for s in panel:
        v = per_state_value.get(s)
        w = arows[s].get(str(year)) or arows[s].get(str(year - 1)) or 0
        if v is not None and w:
            num += v * w
            den += w
    return (num / den) if den else None


def run_crop(crop, cond, fit_states, nass_dir="data/nass"):
    yield_f, acres_f, us_f = CROPS[crop]
    yrows = {ST_ABBR.get(r["state"]): r["values"]
             for r in json.load(open(f"{nass_dir}/{yield_f}"))["rows"] if r["state"] in ST_ABBR}
    arows = {ST_ABBR.get(r["state"]): r["values"]
             for r in json.load(open(f"{nass_dir}/{acres_f}"))["rows"] if r["state"] in ST_ABBR}
    us = {int(k): v for k, v in json.load(open(f"{nass_dir}/{us_f}"))["values"].items()}

    panel = load_pairs_panel(crop, cond["week_ending"], yrows, arows)
    history_source = "pairs-2000" if panel else "nass-local-2010"
    if panel is None:
        panel = build_panel(cond["states"], yrows, arows, fit_states)
    if len(panel) < MIN_STATES:
        raise SystemExit(f"FATAL {crop}: only {len(panel)} usable states (need {MIN_STATES})")
    panel_years = set(p[0] for pairs in panel.values() for p in pairs)
    us_years = sorted(y for y in us if y in panel_years and y < date.today().year)
    if len(us_years) < MIN_YEARS:
        raise SystemExit(f"FATAL {crop}: only {len(us_years)} backtest years (need {MIN_YEARS})")

    def calibration(exclude=None):
        ks = []
        for y in us_years:
            if y == exclude:
                continue
            actual = {s: next((p[2] for p in pairs if p[0] == y), None) for s, pairs in panel.items()}
            agg = aggregate(panel, arows, y, actual)
            if agg:
                ks.append(us[y] / agg)
        return sum(ks) / len(ks)

    # ── leave-one-year-out backtest at this week ──
    errors = []
    for hold in us_years:
        est = {}
        for s, pairs in panel.items():
            train = [p for p in pairs if p[0] != hold]
            cur = [p for p in pairs if p[0] == hold]
            if not cur or len(train) < MIN_YEARS - 2:
                continue
            est[s] = state_estimate(train, hold, cur[0][1])
        agg = aggregate(panel, arows, hold, est)
        if agg is None:
            continue
        errors.append(agg * calibration(exclude=hold) - us[hold])
    if len(errors) < MIN_YEARS - 2:
        raise SystemExit(f"FATAL {crop}: backtest produced only {len(errors)} years")
    abs_err = sorted(abs(e) for e in errors)
    mae = sum(abs_err) / len(abs_err)
    band80 = abs_err[max(0, int(0.8 * len(abs_err)) - 1)]

    # trend-only baseline (no ratings): what "nobody knows in July" implies
    trend_errs = []
    for hold in us_years:
        yrs = [y for y in us_years if y != hold]
        a, b = linfit(yrs, [us[y] for y in yrs])
        trend_errs.append(abs(a + b * hold - us[hold]))
    trend_mae = sum(trend_errs) / len(trend_errs)

    # ── this year's nowcast ──
    this_year = date.today().year
    est_now = {}
    for s, pairs in panel.items():
        ge_now = cond["states"][s].get("ge")
        if ge_now is None:
            continue
        est_now[s] = state_estimate(pairs, this_year, float(ge_now))
    if len(est_now) < MIN_STATES:
        raise SystemExit(f"FATAL {crop}: only {len(est_now)} states have a current rating")
    nowcast = aggregate(panel, arows, this_year, est_now) * calibration()

    a, b = linfit(us_years, [us[y] for y in us_years])
    trend = a + b * this_year

    return {
        "history_source": history_source,
        "week_ending": cond["week_ending"],
        "nowcast": round(nowcast, 1),
        "band80": round(band80, 1),
        "mae": round(mae, 1),
        "trend": round(trend, 1),
        "trend_mae": round(trend_mae, 1),
        "skill_pct": round(100 * (1 - mae / trend_mae)),
        "states": len(est_now),
        "backtest_years": len(errors),
        "unit": "bu/acre",
    }


def main(force_stale=False):
    cond_all = json.load(open("data/conditions/conditions.json"))["crops"]
    fits = json.load(open("data/cond-yield/fit.json"))["crops"]

    # staleness gate: off-season Tuesdays must not fabricate a "new" nowcast
    we = cond_all["corn"]["week_ending"]
    age = (date.today() - date.fromisoformat(we)).days
    if age > STALE_DAYS and not force_stale:
        print(f"ratings week_ending {we} is {age} days old — off-season, keeping last nowcast. exit 0")
        return

    try:
        prev = json.load(open(OUT))
    except FileNotFoundError:
        prev = {"history": {"corn": [], "soybeans": []}}

    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": "ge-linear-v1",
        "note": ("Ratings-only nowcast of US final yield. Band is the 80th percentile of "
                 "absolute leave-one-year-out backtest errors AT THIS WEEK — recomputed every "
                 "run, never assumed. trend_mae is the no-ratings baseline. History rows are "
                 "append-only; final USDA yield is written beside them in January, misses included."),
        "crops": {},
        "history": prev.get("history", {"corn": [], "soybeans": []}),
    }
    for crop in CROPS:
        r = run_crop(crop, cond_all[crop], list(fits[crop]["states"]))
        out["crops"][crop] = r
        hist = [h for h in out["history"].get(crop, []) if h["week_ending"] != r["week_ending"]]
        hist.append({"week_ending": r["week_ending"], "nowcast": r["nowcast"], "band80": r["band80"]})
        hist.sort(key=lambda h: h["week_ending"])
        out["history"][crop] = hist
        print(f"  {crop}: {r['nowcast']} ±{r['band80']} bu/ac  (trend {r['trend']}, "
              f"MAE {r['mae']} vs trend-only {r['trend_mae']}, skill {r['skill_pct']}%, "
              f"{r['states']} states, {r['backtest_years']} yrs)")
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"wrote {OUT}")


def _selftest():
    """Synthetic panel with a PLANTED signal: yield dev = 0.5*(GE-70) + noise.
    The model must recover the signal (LOO MAE well under trend-only MAE) and
    refuse a too-thin panel."""
    import random
    rnd = random.Random(42)
    ok = True

    def chk(c, m):
        nonlocal ok
        print(("  OK   " if c else "  FAIL ") + m)
        ok = ok and c

    years = list(range(2010, 2026))
    states = [f"S{i}" for i in range(12)]
    panel = {}
    us_actual = {}
    for y in years:
        us_actual[y] = 0.0
    for s in states:
        base = 150 + rnd.random() * 40
        tr = 1.5 + rnd.random()
        pairs = []
        for y in years:
            ge = 45 + rnd.random() * 40
            dev = 0.5 * (ge - 65) + rnd.gauss(0, 2)
            pairs.append((y, ge, base + tr * (y - 2010) + dev))
        panel[s] = pairs
    arows = {s: {str(y): 1.0 for y in years + [2026]} for s in states}
    for y in years:
        us_actual[y] = sum(next(p[2] for p in panel[s] if p[0] == y) for s in states) / len(states)

    # LOO through the same machinery
    errors, trend_errs = [], []
    for hold in years:
        est = {s: state_estimate([p for p in panel[s] if p[0] != hold], hold,
                                 next(p[1] for p in panel[s] if p[0] == hold)) for s in states}
        agg = aggregate(panel, arows, hold, est)
        errors.append(abs(agg - us_actual[hold]))
        yrs = [y for y in years if y != hold]
        a, b = linfit(yrs, [us_actual[y] for y in yrs])
        trend_errs.append(abs(a + b * hold - us_actual[hold]))
    mae = sum(errors) / len(errors)
    tmae = sum(trend_errs) / len(trend_errs)
    chk(mae < 1.5, f"planted signal recovered (LOO MAE {mae:.2f} < 1.5)")
    chk(mae < 0.5 * tmae, f"beats trend-only baseline by 2x+ ({mae:.2f} vs {tmae:.2f})")

    # trend-only pairs (no GE signal) must NOT show fake skill
    panel2 = {s: [(y, 45 + rnd.random() * 40, 150 + 1.5 * (y - 2010) + rnd.gauss(0, 3))
                  for y in years] for s in states}
    us2 = {y: sum(next(p[2] for p in panel2[s] if p[0] == y) for s in states) / len(states) for y in years}
    e2, t2 = [], []
    for hold in years:
        est = {s: state_estimate([p for p in panel2[s] if p[0] != hold], hold,
                                 next(p[1] for p in panel2[s] if p[0] == hold)) for s in states}
        e2.append(abs(aggregate(panel2, arows, hold, est) - us2[hold]))
        yrs = [y for y in years if y != hold]
        a, b = linfit(yrs, [us2[y] for y in yrs])
        t2.append(abs(a + b * hold - us2[hold]))
    chk(sum(e2) / len(e2) < 1.6 * (sum(t2) / len(t2)),
        "no-signal panel shows no runaway fake skill (LOO stays near trend baseline)")

    # thin panel refusal
    thin = {"S0": panel["S0"][:6]}
    chk(len(build_panel({"S0": {"hist": []}}, {}, {}, ["S0"])) == 0, "thin/absent states are dropped, not fitted")

    # linfit sanity
    a, b = linfit([1, 2, 3], [2, 4, 6])
    chk(abs(b - 2) < 1e-9 and abs(a) < 1e-9, "linfit exact on a perfect line")
    print("SELFTEST " + ("OK" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    main(force_stale="--force-stale" in sys.argv)
