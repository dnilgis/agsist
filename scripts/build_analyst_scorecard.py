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
import sys
from datetime import datetime, timezone

# THE SAME BAND THE TRACK RECORD USES. This file carried its own flat 2%, and on
# 2026-09-09 the page called 2026/27 corn yield BULLISH in one section and IN
# LINE in another — same consensus, same print, two builders. See
# scripts/report_bands.py, which also explains why a yield gets a tighter band.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_bands import surprise as band_surprise  # noqa: E402

EST_PATH = "data/analyst-estimates.json"
OUT_PATH = "data/analyst-scorecard.json"
MIN_N = 3   # scored calls required before an analyst is ranked

# ── THE MODEL'S OWN CALLS, WHICH WERE NEVER ON ITS OWN BOARD ─────────────────
#
# AGSIST's yield nowcast locks a corn and a soybean number into
# data/nowcast-direction.json days before each WASDE, and grades itself against
# the print afterwards. Those locked calls were only ever read by the
# conditions-yield page. So on 2026-09-10 — the day before a September WASDE the
# model had already called (corn 182.6, beans 54.1, locked Aug 18) — this
# board rendered "No calls filed yet."
#
# It joins them here, under one rule: only the number that was LOCKED is used.
# Never a live recompute — a call that moves after it is made is not a call —
# and never one whose lock date is missing or falls on/after the report it
# forecasts, because that is a call made with the answer in hand.
NOWCAST_PATH = "data/nowcast-direction.json"
NOWCAST_ID = "agsist"            # must match the roster id in analyst-estimates.json
NOWCAST_LINK = "https://agsist.com/conditions-yield"  # same form the typed rows use
NOWCAST_CROP_KEY = {"corn": "corn_yield", "soybeans": "soy_yield"}


def _load():
    if not os.path.exists(EST_PATH):
        # AN EMPTY BUILD IS A SET OF POSITIVE FALSE CLAIMS, NOT A BLANK PAGE.
        # This used to return an empty roster and exit 0. The 134-byte scorecard
        # that produced was then baked into the page, which published "No
        # forecasters scored yet", "No calls filed yet", "No graded forecaster
        # calls yet" and a ribbon saying scoring begins with the June WASDE --
        # four assertions, all false, all committed by a green workflow, over a
        # roster that never stops saying "Roster loading...". Refuse instead.
        sys.exit("build_analyst_scorecard: %s is missing. Refusing to write an "
                 "empty scorecard: an empty file publishes 'No forecasters "
                 "scored yet' as a fact." % EST_PATH)
    with open(EST_PATH) as f:
        return json.load(f)


def _roster_map(data):
    m = {}
    for a in data.get("analysts", []):
        if a.get("id"):
            m[a["id"]] = {"analyst": a.get("analyst", a["id"]), "firm": a.get("firm", "")}
    return m


def _surprise(consensus, actual, label=""):
    """Metric-level label, from the shared rule.

    The empty string means there was no consensus to compare against, and it is
    NOT the same as "in line". The page used to render `m.surprise || 'in line'`,
    so a metric nobody had filed an estimate for was published as having landed
    where the trade expected. It now prints the reason instead."""
    return band_surprise(consensus, actual, label)


def merge_locked_model_calls(reports, path=NOWCAST_PATH):
    """Fold the locked yield nowcasts into the matching report metrics as
    estimates from NOWCAST_ID, so the board shows the house call alongside the
    trade's. Returns (merged, refused) counts. Never overwrites a hand-typed
    estimate for the same id — the file a person maintains wins."""
    if not os.path.exists(path):
        return 0, 0
    try:
        with open(path) as f:
            nc = json.load(f)
    except (ValueError, OSError):
        return 0, 0

    by_date = {}
    for r in reports:
        if r.get("date"):
            by_date.setdefault(r["date"], []).append(r)

    merged = refused = 0
    for call in nc.get("calls", []):
        when = call.get("wasde")
        crop = (call.get("crop") or "").lower()
        value = call.get("model")
        locked = call.get("locked_on")
        if when not in by_date or value is None:
            continue
        # A call is only a call if it was locked, and locked BEFORE the print.
        if not locked or locked >= when:
            refused += 1
            continue
        prefix = NOWCAST_CROP_KEY.get(crop)
        if not prefix:
            continue
        for r in by_date[when]:
            for met in r.get("metrics", []):
                key = met.get("key") or ""
                if not (key.startswith(prefix) and "yield" in key):
                    continue
                # A graded metric is NOT skipped. The merge is in-memory only —
                # analyst-estimates.json is never rewritten — so skipping here
                # would make the model's call visible on the board before the
                # report and gone from the record after it. It carries through
                # and gets scored like anyone else's.
                ests = met.setdefault("estimates", [])
                if any(e.get("id") == NOWCAST_ID for e in ests):
                    continue   # a person typed it; leave theirs alone
                ests.append({"id": NOWCAST_ID, "value": value,
                             "source": NOWCAST_LINK, "locked_on": locked})
                merged += 1
    return merged, refused


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
                                   "value": est["value"], "unit": met.get("unit", ""),
                                   "locked_on": est.get("locked_on")})
            if est.get("locked_on") and not row.get("locked_on"):
                row["locked_on"] = est["locked_on"]
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
            # A NUMBER WE COMPUTED CANNOT WIN A CONTEST OF WHAT PEOPLE SAID.
            # `derived` marks an estimate AGSIST reduced to a point from a range
            # the forecaster published. Jerry Gulke said "180.5 to 181"; the
            # midpoint 180.75 landed 0.05 from the print and took the closest
            # call, while Robert McClure's PUBLISHED 180.8 was 0.10 away. On
            # either number Gulke actually said, McClure was closer. The
            # midpoint is kept so the call can be scored at all, and it is
            # disclosed on the page -- but it does not get to win.
            judged = [e for e in ests if not e.get("derived")]
            best_err = min((abs(e["value"] - actual) for e in judged), default=None)
            results = []
            for e in ests:
                v = e["value"]
                err = abs(v - actual)
                err_pct = err / abs(actual) * 100
                signed_pct = (v - actual) / abs(actual) * 100
                beat = (consensus is not None) and \
                    (abs(consensus - actual) - err) > 1e-9 * (abs(actual) or 1.0)
                # THE SAME GUARD `wins` ALREADY USES. Without it, the only
                # house to file a figure gets the "closest call" star every
                # time -- June's soybean ending stocks starred a lone entry that
                # was 2.58% off and further from the print than the consensus.
                # The badge was counting coverage, not accuracy.
                closest = (best_err is not None) and (not e.get("derived")) \
                    and (abs(err - best_err) < 1e-9) and len(judged) >= 2
                aid = e.get("id")
                info = roster.get(aid, {"analyst": aid, "firm": ""})
                results.append({"analyst": info["analyst"], "firm": info["firm"],
                                "value": v, "err_pct": round(err_pct, 2),
                                "signed_pct": round(signed_pct, 2),
                                "beat": beat, "has_consensus": consensus is not None,
                                # HOW THE NUMBER GOT HERE, CARRIED TO THE PAGE.
                                # Some estimates are a midpoint AGSIST computed
                                # because the analyst published a range -- Jerry
                                # Gulke's August corn 180.75 is the midpoint of
                                # his stated 180.5-181.0. The note explaining
                                # that was typed into analyst-estimates.json and
                                # then dropped right here, so the board rendered
                                # "0.03% off, closest call" on a figure he never
                                # said. On either number he DID say, McClure's
                                # published 180.8 was closer.
                                "source_note": e.get("source_note"),
                                "derived": bool(e.get("derived")),
                                "locked_on": e.get("locked_on"),
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
                if closest and len(judged) >= 2:
                    a["wins"] += 1
            results.sort(key=lambda x: x["err_pct"])
            label = met.get("label", met.get("key", ""))
            rep_metrics.append({"label": label,
                                "unit": met.get("unit", ""), "consensus": consensus,
                                "actual": actual,
                                "surprise": _surprise(consensus, actual, label),
                                # WHERE THE CONSENSUS CAME FROM. Typed into
                                # analyst-estimates.json beside every figure and
                                # then dropped here, so the page cited nothing
                                # for any number it printed.
                                "consensus_source": met.get("consensus_source"),
                                "consensus_range": met.get("consensus_range"),
                                # HOW MANY FORECASTERS WERE ON IT. A metric with
                                # one estimate and a metric with eight are not
                                # the same evidence and used to look identical.
                                "n_estimates": len(ests),
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
               "beat_rate": (round(a["beat_yes"] / a["beat_n"] * 100) if a["beat_n"] else None),
               # HOW MANY OF THIS ANALYST'S CALLS HAD A TRADE ESTIMATE TO BEAT.
               # beat_rate is None when none of them did, and the page printed a
               # bare dash for it, which reads as a zero to anybody skimming.
               "beat_n": a["beat_n"],
               "qualified": a["n"] >= MIN_N,
               "needs": max(0, MIN_N - a["n"])}
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
            if met.get("actual") is not None:
                continue   # already released & scored -> it's on the scorecard, not the board
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
                              "locked_on": e.get("locked_on"),
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

    merged, refused = merge_locked_model_calls(data.get("reports", []))

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
    print(f"[analyst-scorecard] locked model calls merged={merged} refused={refused}")


def _selftest():
    """The lock rule, exercised. No network, no repo files — every case builds its
    own report and its own nowcast file. Run by .github/workflows/analyst-scorecard.yml
    before the build, so a change to the rule cannot ship silently."""
    import tempfile

    def nowcast(calls):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({"calls": calls}, f)
        f.close()
        return f.name

    def report():
        return [{"date": "2026-09-11", "report": "September WASDE", "metrics": [
            {"key": "corn_yield_2627", "label": "corn", "unit": "bu/acre",
             "usda_current": 180.7, "estimates": []}]}]

    cases = [
        ("locked before the print merges",
         [{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "locked_on": "2026-08-18"}], (1, 0)),
        ("locked ON the print is refused",
         [{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "locked_on": "2026-09-11"}], (0, 1)),
        ("locked after the print is refused",
         [{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "locked_on": "2026-09-12"}], (0, 1)),
        ("a call with no lock date is refused",
         [{"wasde": "2026-09-11", "crop": "corn", "model": 182.6}], (0, 1)),
        ("no model number, nothing to merge",
         [{"wasde": "2026-09-11", "crop": "corn", "model": None, "locked_on": "2026-08-18"}], (0, 0)),
        ("a crop with no metric here is skipped",
         [{"wasde": "2026-09-11", "crop": "oats", "model": 90, "locked_on": "2026-08-18"}], (0, 0)),
        ("a call for a report we do not carry is skipped",
         [{"wasde": "2026-10-09", "crop": "corn", "model": 182.6, "locked_on": "2026-08-18"}], (0, 0)),
    ]
    ok = True
    for name, calls, want in cases:
        path = nowcast(calls)
        got = merge_locked_model_calls(report(), path)
        os.unlink(path)
        good = got == want
        ok &= good
        print(("  ok    " if good else "  FAIL  ") + name + ("" if good else f"  got {got} want {want}"))

    # A number a person typed is never replaced by the model's.
    r = report()
    r[0]["metrics"][0]["estimates"] = [{"id": NOWCAST_ID, "value": 999.0, "source": "typed"}]
    path = nowcast([{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "locked_on": "2026-08-18"}])
    got = merge_locked_model_calls(r, path)
    os.unlink(path)
    good = got == (0, 0) and [e["value"] for e in r[0]["metrics"][0]["estimates"]] == [999.0]
    ok &= good
    print(("  ok    " if good else "  FAIL  ") + "a hand-typed estimate is not overwritten")

    # A graded metric keeps the call, or the model would vanish from its own record.
    r = report()
    r[0]["metrics"][0]["actual"] = 180.0
    path = nowcast([{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "locked_on": "2026-08-18"}])
    got = merge_locked_model_calls(r, path)
    os.unlink(path)
    good = got == (1, 0)
    ok &= good
    print(("  ok    " if good else "  FAIL  ") + "a graded metric keeps the call")

    good = merge_locked_model_calls(report(), "/nonexistent-nowcast.json") == (0, 0)
    ok &= good
    print(("  ok    " if good else "  FAIL  ") + "a missing nowcast file is not fatal")

    print()
    print("analyst-scorecard: " + ("all passed" if ok else "FAILURES ABOVE"))
    return 0 if ok else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    main()
