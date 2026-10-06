#!/usr/bin/env python3
# math is used for the nearest-rank percentile in run_crop().
import math
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
  - The error band is NOT a formula prior: it is the 80th percentile
    (nearest rank) of absolute EXPANDING-WINDOW errors at THIS week -- each
    held-out year estimated from earlier years only, as a real-time reader
    would have had it -- recomputed every run, n stated beside it. The
    leave-one-year-out figures (which let a year learn from later ones) ship
    as loyo_* for transparency, never as the band.
  - The trend-only MAE (same held-out years, same rule, ratings term
    removed) ships alongside so the reader sees the skill, not just the
    number. The PRINTED trend is fitted on every final year before this one.
  - Every weekly nowcast is appended to history and never edited; a rerun
    that produces a DIFFERENT number for a week already recorded is appended
    beside the old row with its generation time, not written over it. The
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


def calibration(panel, arows, us, years):
    """k = mean(US_actual / state_agg) over `years` (the caller chooses which
    years it is allowed to see)."""
    ks = []
    for y in years:
        actual = {s: next((p[2] for p in pairs if p[0] == y), None) for s, pairs in panel.items()}
        agg = aggregate(panel, arows, y, actual)
        if agg:
            ks.append(us[y] / agg)
    return sum(ks) / len(ks) if ks else None


def state_trend_only(pairs, target_year, ge_now=None):
    """The same state trend with the ratings term removed: the no-ratings
    baseline, built from exactly the history the model saw."""
    ta, tb = linfit([p[0] for p in pairs], [p[2] for p in pairs])
    return ta + tb * target_year


def _held_out_error(panel, arows, us, hold, train_ok, calib_years, estimator=None):
    """Error for one held-out year. train_ok(year) decides which history the
    state fits may use. Returns (error, newest year any fit or the calibration
    saw) or None."""
    est, seen = {}, []
    for s, pairs in panel.items():
        train = [p for p in pairs if train_ok(p[0])]
        cur = [p for p in pairs if p[0] == hold]
        if not cur or len(train) < MIN_YEARS - 2:
            continue
        est[s] = (estimator or state_estimate)(train, hold, cur[0][1])
        seen.extend(p[0] for p in train)
    agg = aggregate(panel, arows, hold, est)
    k = calibration(panel, arows, us, calib_years)
    if agg is None or k is None:
        return None
    return agg * k - us[hold], max(seen + list(calib_years))


def loyo_errors(panel, arows, us, us_years):
    """Leave-one-year-out (uses LATER years too). Kept for transparency only."""
    out = []
    for hold in us_years:
        r = _held_out_error(panel, arows, us, hold, lambda y, h=hold: y != h,
                            [y for y in us_years if y != hold])
        if r:
            out.append((hold, r[0], r[1]))
    return out


def expanding_errors(panel, arows, us, us_years, estimator=None):
    """Pseudo real-time: each held-out year sees only years BEFORE it, in the
    state fits and in the calibration. Returns [(hold, error, newest_seen)]."""
    out = []
    for hold in us_years:
        prior = [y for y in us_years if y < hold]
        if not prior:
            continue
        r = _held_out_error(panel, arows, us, hold, lambda y, h=hold: y < h, prior, estimator)
        if r:
            out.append((hold, r[0], r[1]))
    return out


def mae_p80(errors):
    abs_err = sorted(abs(e) for e in errors)
    # Nearest-rank p80. int(0.8*n)-1 lands one index low -- with n=16 it
    # returned the 12th of 16 sorted errors, which is the 75th percentile,
    # under a label that says 80%.
    return sum(abs_err) / len(abs_err), abs_err[max(0, math.ceil(0.8 * len(abs_err)) - 1)]


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

    errors_loyo = loyo_errors(panel, arows, us, us_years)
    if len(errors_loyo) < MIN_YEARS - 2:
        raise SystemExit(f"FATAL {crop}: backtest produced only {len(errors_loyo)} years")
    loyo_mae, loyo_band = mae_p80([e for _, e, _ in errors_loyo])

    # ── PUBLISHED band: expanding-window backtest at this week ──
    # Each held-out year is estimated from EARLIER years only (state fits and
    # the national calibration both), which is the information a real-time
    # reader had. Leave-one-year-out lets 2019 learn from 2023 and reads
    # tighter than the model could ever have been in real time; it is kept
    # beside it (loyo_*) for transparency, not published as the band.
    errs = expanding_errors(panel, arows, us, us_years)
    if len(errs) < MIN_YEARS - 2:
        raise SystemExit(f"FATAL {crop}: expanding-window backtest produced only {len(errs)} years")
    mae, band80 = mae_p80([e for _, e, _ in errs])
    held = [h for h, _, _ in errs]

    # trend-only baseline (no ratings), scored on the SAME held-out years by
    # the SAME expanding rule: the model's own state trends + calibration with
    # the ratings term removed. A US-level trend would see only 2010+ finals
    # while the state fits see 2001+, and the "skill" would partly be that.
    terrs = expanding_errors(panel, arows, us, us_years, estimator=state_trend_only)
    assert [h for h, _, _ in terrs] == held, "trend baseline scored on different years"
    trend_mae = sum(abs(e) for _, e, _ in terrs) / len(terrs)

    # ── this year's nowcast ──
    this_year = date.today().year
    est_now = {}
    for s, pairs in panel.items():
        # A state NASS has stopped rating for the season is absent, not null:
        # 2026-09-29 crashed on KeyError 'OK' and the nowcast went 14 days
        # without a run. Absent and null are the same fact -- no rating this
        # week -- so the state is left out and `states` says how many remain.
        ge_now = cond["states"].get(s, {}).get("ge")
        if ge_now is None:
            continue
        est_now[s] = state_estimate(pairs, this_year, float(ge_now))
    if len(est_now) < MIN_STATES:
        raise SystemExit(f"FATAL {crop}: only {len(est_now)} states have a current rating")
    nowcast = aggregate(panel, arows, this_year, est_now) * calibration(panel, arows, us, us_years)

    # The PRINTED trend uses every final year before this one, not us_years:
    # us_years is "years with a rating this week", so a trend fitted on it
    # moved week to week (184.9 at week 40, 188.7 on all 2010-2025 finals)
    # while nothing about the trend had changed.
    trend_years = sorted(y for y in us if y < this_year)
    a, b = linfit(trend_years, [us[y] for y in trend_years])
    trend = a + b * this_year
    mae_r, tmae_r = round(mae, 1), round(trend_mae, 1)

    return {
        "history_source": history_source,
        "week_ending": cond["week_ending"],
        "nowcast": round(nowcast, 1),
        "band80": round(band80, 1),
        "mae": mae_r,
        "band_method": "expanding-window",
        "trend": round(trend, 1),
        "trend_window": f"{trend_years[0]}-{trend_years[-1]}",
        "trend_n": len(trend_years),
        "trend_mae": tmae_r,
        # From the ROUNDED MAEs the page prints, so a reader can reproduce it.
        "skill_pct": round(100 * (1 - mae_r / tmae_r)) if tmae_r else None,
        "states": len(est_now),
        "backtest_years": len(errs),
        "backtest_window": f"{held[0]}-{held[-1]}",
        "loyo_mae": round(loyo_mae, 2),
        "loyo_band80": round(loyo_band, 2),
        "loyo_years": len(errors_loyo),
        "unit": "bu/acre",
    }


def append_history(hist, r, generated):
    """Append-only. Same week, same numbers -> nothing to add (idempotent).
    Same week, DIFFERENT numbers (a method change, a late data revision) ->
    the new row goes in beside the old one with its generation time; the old
    row is never replaced, so what was published that week stays on record."""
    row = {"week_ending": r["week_ending"], "nowcast": r["nowcast"], "band80": r["band80"]}
    same = [h for h in hist if h["week_ending"] == r["week_ending"]]
    if same and same[-1]["nowcast"] == row["nowcast"] and same[-1]["band80"] == row["band80"]:
        return hist
    if same:
        row["generated"] = generated
        if r.get("band_method"):
            row["band_method"] = r["band_method"]
    out = list(hist) + [row]
    out.sort(key=lambda h: (h["week_ending"], h.get("generated", "")))
    return out


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
        "note": ("Ratings-only nowcast of US final yield. band80 is the 80th percentile "
                 "(nearest rank) of absolute EXPANDING-WINDOW backtest errors AT THIS WEEK: "
                 "each held-out year is estimated from earlier years only (backtest_years "
                 "says how many, backtest_window which). loyo_* are the leave-one-year-out "
                 "figures, which use later years, kept for transparency and not used for the "
                 "band. trend_mae is the no-ratings baseline on the same years by the same "
                 "rule; skill_pct is computed from the rounded MAEs as printed. trend is "
                 "fitted on every US final in trend_window. History rows are append-only: a "
                 "rerun that changes a recorded week adds a row with its generation time "
                 "beside the old one. Final USDA yield is written beside them in January, "
                 "misses included."),
        "crops": {},
        "history": prev.get("history", {"corn": [], "soybeans": []}),
    }
    for crop in CROPS:
        r = run_crop(crop, cond_all[crop], list(fits[crop]["states"]))
        out["crops"][crop] = r
        out["history"][crop] = append_history(out["history"].get(crop, []), r, out["generated"])
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

    # expanding window: the band never sees the held-out year or a later one
    ex = expanding_errors(panel, arows, us_actual, years)
    chk(bool(ex) and all(seen < hold for hold, _, seen in ex),
        f"expanding window trains only on earlier years ({[(h, s) for h, _, s in ex]})")
    # ...and poisoning every year from 2022 on cannot move an earlier year's error
    poisoned = {s: [(y, g, v + (500 if y >= 2022 else 0)) for y, g, v in pairs] for s, pairs in panel.items()}
    us_p = {y: v + (500 if y >= 2022 else 0) for y, v in us_actual.items()}
    ex_p = expanding_errors(poisoned, arows, us_p, years)
    early = {h: e for h, e, _ in ex if h < 2022}
    early_p = {h: e for h, e, _ in ex_p if h < 2022}
    chk(early and all(abs(early[h] - early_p[h]) < 1e-9 for h in early),
        "future years cannot leak into an earlier held-out year (poison test)")
    lo = loyo_errors(panel, arows, us_actual, years)
    chk(any(seen > hold for hold, _, seen in lo), "control: LOYO does see later years (why it is not the band)")
    m, p = mae_p80([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    chk(abs(m - 5.5) < 1e-9 and p == 8, f"nearest-rank p80 of 1..10 is 8 (got {p})")

    # history is append-only: a changed rerun keeps the old row
    h0 = [{"week_ending": "2026-10-04", "nowcast": 180.6, "band80": 6.9}]
    h1 = append_history(h0, {"week_ending": "2026-10-04", "nowcast": 180.6, "band80": 6.9}, "t1")
    chk(h1 == h0, "identical rerun adds nothing")
    h2 = append_history(h0, {"week_ending": "2026-10-04", "nowcast": 180.6, "band80": 7.0}, "t2")
    chk(len(h2) == 2 and h2[0] == h0[0] and h2[1].get("generated") == "t2",
        "changed rerun appends beside the old row, never over it")

    # linfit sanity
    a, b = linfit([1, 2, 3], [2, 4, 6])
    chk(abs(b - 2) < 1e-9 and abs(a) < 1e-9, "linfit exact on a perfect line")
    print("SELFTEST " + ("OK" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    main(force_stale="--force-stale" in sys.argv)
