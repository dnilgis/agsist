#!/usr/bin/env python3
"""
build_analyst_scorecard.py — assembles data/analyst-scorecard.json for the
USDA Report Analyst Scorecard page (analyst-scorecard.html).

Reads one human-maintained source file:
  data/analyst-estimates.json — a roster of forecasters + per-report, per-metric
  estimates, the trade consensus, and (after a report releases) the USDA actual.

and emits data/analyst-scorecard.json in the shape the page consumes:
  { updated, sample, min_n, upcoming{...}, leaderboard[...], building[...], reports[...] }

THREE SCORING VIEWS, all scale-free so corn (bil bu), wheat (mil bu) and yield
(bu/acre) can be aggregated in one table:
  • Accuracy   — mean absolute % error vs the USDA actual (lower is better)
  • Beat-trade — % of metrics where the analyst was closer than the trade consensus
  • Bias       — mean SIGNED % error (positive = runs high, negative = runs low)

Only metrics with a real `actual` are scored. Analysts need >= MIN_N scored
calls before they appear ranked (a 2-call leaderboard is noise). Everyone else
sits in `building` with their running count. No backtest is fabricated — the
file simply accrues as you fill real numbers each cycle.

Stdlib only. No secrets, no network.
"""
import json
import os
from datetime import datetime, timezone

EST_PATH = "data/analyst-estimates.json"
OUT_PATH = "data/analyst-scorecard.json"
MIN_N = 3   # scored calls required before an analyst is ranked


def _load():
    if not os.path.exists(EST_PATH):
        return {"analysts": [], "reports": []}
    with open(EST_PATH) as f:
        return json.load(f)


def _roster_map(data):
    m = {}
    for a in data.get("analysts", []):
        if a.get("id"):
            m[a["id"]] = {"analyst": a.get("analyst", a["id"]), "firm": a.get("firm", "")}
    return m


def _surprise(consensus, actual):
    """Metric-level label (reuses the What's Priced In convention: a print below
    the trade estimate is bullish/less supply, above is bearish)."""
    if consensus in (None, 0) or actual is None:
        return ""
    gap = (actual - consensus) / abs(consensus)
    if abs(gap) <= 0.02:
        return "in line"
    return "bullish" if actual < consensus else "bearish"


def build_upcoming(reports, roster, today):
    future = sorted((r for r in reports if (r.get("date") or "") >= today),
                    key=lambda r: r["date"])
    if not future:
        return None
    r = future[0]
    # collect, per analyst, the values they're on record for in this report
    by_analyst = {}
    for met in r.get("metrics", []):
        for est in met.get("estimates", []):
            if est.get("value") is None:
                continue
            aid = est.get("id")
            info = roster.get(aid, {"analyst": aid, "firm": ""})
            row = by_analyst.setdefault(aid, {"analyst": info["analyst"], "firm": info["firm"],
                                              "metrics": [], "source": est.get("source")})
            row["metrics"].append({"label": met.get("label", met.get("key", "")),
                                   "value": est["value"], "unit": met.get("unit", "")})
            if est.get("source") and not row["source"]:
                row["source"] = est["source"]
    panel = sorted(by_analyst.values(), key=lambda x: x["analyst"].lower())
    return {"report": r.get("report", ""), "date": r.get("date", ""), "panel": panel}


def score(data, roster, today):
    agg = {}          # aid -> running stats
    scored_reports = []
    for r in data.get("reports", []):
        rep_metrics = []
        any_scored = False
        for met in r.get("metrics", []):
            actual = met.get("actual")
            consensus = met.get("consensus")
            if actual is None:
                continue   # not released / scored yet
            any_scored = True
            ests = [e for e in met.get("estimates", []) if e.get("value") is not None]
            # find closest for this metric
            best_err = min((abs(e["value"] - actual) for e in ests), default=None)
            results = []
            for e in ests:
                v = e["value"]
                err = abs(v - actual)
                err_pct = err / abs(actual) * 100
                signed_pct = (v - actual) / abs(actual) * 100
                beat = (consensus is not None) and \
                    (abs(consensus - actual) - err) > 1e-9 * (abs(actual) or 1.0)
                closest = (best_err is not None) and (abs(err - best_err) < 1e-9)
                aid = e.get("id")
                info = roster.get(aid, {"analyst": aid, "firm": ""})
                results.append({"analyst": info["analyst"], "firm": info["firm"],
                                "value": v, "err_pct": round(err_pct, 2),
                                "signed_pct": round(signed_pct, 2),
                                "beat": beat, "has_consensus": consensus is not None,
                                "closest": closest})
                a = agg.setdefault(aid, {"analyst": info["analyst"], "firm": info["firm"],
                                         "n": 0, "err_sum": 0.0, "signed_sum": 0.0,
                                         "beat_yes": 0, "beat_n": 0, "wins": 0})
                a["n"] += 1
                a["err_sum"] += err_pct
                a["signed_sum"] += signed_pct
                if consensus is not None:
                    a["beat_n"] += 1
                    if beat:
                        a["beat_yes"] += 1
                if closest:
                    a["wins"] += 1
            results.sort(key=lambda x: x["err_pct"])
            rep_metrics.append({"label": met.get("label", met.get("key", "")),
                                "unit": met.get("unit", ""), "consensus": consensus,
                                "actual": actual, "surprise": _surprise(consensus, actual),
                                "results": results})
        if any_scored:
            scored_reports.append({"report": r.get("report", ""), "date": r.get("date", ""),
                                   "metrics": rep_metrics})

    leaderboard, building = [], []
    for aid, a in agg.items():
        row = {"analyst": a["analyst"], "firm": a["firm"], "n": a["n"],
               "mape": round(a["err_sum"] / a["n"], 2),
               "bias": round(a["signed_sum"] / a["n"], 2),
               "wins": a["wins"],
               "beat_rate": (round(a["beat_yes"] / a["beat_n"] * 100) if a["beat_n"] else None)}
        (leaderboard if a["n"] >= MIN_N else building).append(row)
    leaderboard.sort(key=lambda x: x["mape"])
    building.sort(key=lambda x: (-x["n"], x["analyst"].lower()))
    scored_reports.sort(key=lambda x: x.get("date") or "", reverse=True)
    return leaderboard, building, scored_reports


def build_pipeline(reports, roster, today):
    """Forward ledger: every report still ahead of us that already has at least one
    filed forecast, with each call annotated by how far it leans from the reference
    (the trade consensus if we have it, else USDA's current standing projection).
    A supply-side print below the reference is a bullish lean, above is bearish."""
    out = []
    for r in sorted((x for x in reports if (x.get("date") or "") >= today),
                    key=lambda x: x["date"]):
        mets = []
        for met in r.get("metrics", []):
            ref = met.get("consensus")
            ref_label = "vs trade"
            if ref is None:
                ref = met.get("usda_current")
                ref_label = "vs USDA"
            calls = []
            for e in met.get("estimates", []):
                if e.get("value") is None:
                    continue
                aid = e.get("id")
                info = roster.get(aid, {"analyst": aid, "firm": ""})
                v = e["value"]
                dev = None
                lean = "neutral"
                if ref not in (None, 0):
                    dev = round((v - ref) / abs(ref) * 100, 1)
                    if abs(dev) < 0.1:
                        lean = "neutral"
                    else:
                        lean = "bullish" if v < ref else "bearish"   # less supply = bullish
                calls.append({"analyst": info["analyst"], "firm": info["firm"],
                              "value": v, "source": e.get("source"),
                              "ref": ref, "ref_label": ref_label, "dev_pct": dev, "lean": lean})
            if calls:
                calls.sort(key=lambda c: c["analyst"].lower())
                mets.append({"label": met.get("label", met.get("key", "")),
                             "unit": met.get("unit", ""), "consensus": met.get("consensus"),
                             "usda_current": met.get("usda_current"), "calls": calls})
        if mets:
            out.append({"report": r.get("report", ""), "date": r.get("date", ""), "metrics": mets})
    return out


def main():
    data = _load()
    roster = _roster_map(data)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    upcoming = build_upcoming(data.get("reports", []), roster, today)
    pipeline = build_pipeline(data.get("reports", []), roster, today)
    leaderboard, building, reports = score(data, roster, today)
    has_scored = bool(reports)

    out = {"updated": today, "sample": (not has_scored), "min_n": MIN_N,
           "roster": [{"analyst": v["analyst"], "firm": v["firm"]} for v in roster.values()],
           "upcoming": upcoming, "pipeline": pipeline, "leaderboard": leaderboard,
           "building": building, "reports": reports}
    os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    nx = (upcoming["report"] + " " + upcoming["date"]) if upcoming else "none scheduled"
    print(f"[analyst-scorecard] upcoming={nx} | ranked={len(leaderboard)} "
          f"building={len(building)} | scored_reports={len(reports)} | sample={out['sample']}")


if __name__ == "__main__":
    main()
