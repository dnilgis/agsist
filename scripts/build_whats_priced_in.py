#!/usr/bin/env python3
"""
build_whats_priced_in.py — assembles data/whats-priced-in.json for the
"What's Priced In" page (whats-priced-in.html).

Reads two human-maintained source files (edited in the GitHub browser):
  data/wpi-estimates.json — scheduled reports + pre-report trade expectations
  data/wpi-history.json   — past reports scored against the actual print

and emits data/whats-priced-in.json in the exact shape the page consumes:
  { updated, sample, upcoming{...}, history[...] }

What it does beyond pass-through:
  • Picks the next report whose date is today-or-later as `upcoming`
    (so the card rolls over automatically as report dates pass — run daily).
  • Derives the bullish/bearish surprise thresholds from the trade range
    when they aren't spelled out (convention: a print BELOW the low end is
    bullish — less supply — and ABOVE the high end is bearish; this holds
    for both ending-stocks and production metrics).
  • Scores each history row's surprise from expected vs. actual when the
    row doesn't already carry a `surprise` (|gap| <= IN_LINE_PCT -> in line;
    actual < expected -> bullish; actual > expected -> bearish).
  • Sets `sample` to false whenever any real report/history is present, so
    the page's "illustrative" ribbon turns itself off.

Stdlib only. No secrets, no network. Safe to run on every push + daily cron.
"""
import json
import os
import sys
from datetime import datetime, timezone

EST_PATH  = "data/wpi-estimates.json"
HIST_PATH = "data/wpi-history.json"
OUT_PATH  = "data/whats-priced-in.json"
IN_LINE_PCT = 0.02   # within 2% of the trade estimate counts as "in line"

UPCOMING_FIELDS = ["report", "date", "time", "commodity", "metric", "expectation",
                   "estimate_low", "estimate_high", "estimate_avg", "unit",
                   "implied_odds", "bullish_threshold", "bearish_threshold",
                   "positioning"]
HISTORY_FIELDS  = ["date", "report", "metric", "expected", "actual", "unit",
                   "surprise", "reaction"]


def _load(path, key):
    if not os.path.exists(path):
        return []
    with open(path) as f:
        data = json.load(f)
    rows = data.get(key, [])
    return rows if isinstance(rows, list) else []


def _fmt(v, unit):
    """Compact number for threshold strings (drops a trailing .0)."""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return f"{v}{(' ' + unit) if unit else ''}"


def build_upcoming(reports, today):
    future = sorted((r for r in reports if (r.get("date") or "") >= today),
                    key=lambda r: r["date"])
    if not future:
        return None
    r = dict(future[0])
    out = {k: r.get(k) for k in UPCOMING_FIELDS}
    if not isinstance(out.get("implied_odds"), list):
        out["implied_odds"] = []
    lo, hi, unit = out.get("estimate_low"), out.get("estimate_high"), out.get("unit") or ""
    # Derive surprise thresholds from the range only when both bounds exist
    # and the author hasn't supplied explicit threshold text.
    if lo is not None and hi is not None:
        if not out.get("bullish_threshold"):
            out["bullish_threshold"] = "Below " + _fmt(lo, unit)
        if not out.get("bearish_threshold"):
            out["bearish_threshold"] = "Above " + _fmt(hi, unit)
    return out


def score(expected, actual):
    if expected in (None, 0) or actual is None:
        return "in line"
    gap = (actual - expected) / abs(expected)
    if abs(gap) <= IN_LINE_PCT:
        return "in line"
    return "bullish" if actual < expected else "bearish"


def build_history(rows):
    out = []
    for r in rows:
        row = {k: r.get(k) for k in HISTORY_FIELDS}
        if not row.get("surprise"):
            row["surprise"] = score(r.get("expected"), r.get("actual"))
        out.append(row)
    # newest first
    out.sort(key=lambda x: x.get("date") or "", reverse=True)
    return out


def _gap_pct(expected, actual):
    if expected in (None, 0) or actual is None:
        return None
    return round((actual - expected) / abs(expected) * 100, 1)


def build_latest_result(history):
    """Summarize the most recently released report (the newest history date) so the
    page can show a report-day 'how it landed' banner. Picks the biggest surprise by
    absolute gap vs. the trade, and counts how many metrics landed in line. The page
    decides whether to show it based on how recent the date is, so this stays generic
    for every future report."""
    if not history:
        return None
    latest_date = history[0].get("date")          # history is newest-first
    rows = [r for r in history if r.get("date") == latest_date]
    enriched = []
    for r in rows:
        gp = _gap_pct(r.get("expected"), r.get("actual"))
        enriched.append({**{k: r.get(k) for k in HISTORY_FIELDS}, "gap_pct": gp})
    surprises = [r for r in enriched if r.get("surprise") not in ("in line", None)]
    pool = surprises or enriched
    biggest = max(pool, key=lambda r: abs(r.get("gap_pct") or 0)) if pool else None
    in_line = sum(1 for r in enriched if r.get("surprise") == "in line")
    return {
        "date": latest_date,
        "report": rows[0].get("report") if rows else "",
        "metric_count": len(enriched),
        "in_line_count": in_line,
        "all_in_line": (in_line == len(enriched)),
        "biggest_surprise": biggest,
    }


def main():
    reports = _load(EST_PATH, "reports")
    hist_rows = _load(HIST_PATH, "history")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    upcoming = build_upcoming(reports, today)
    history = build_history(hist_rows)
    latest_result = build_latest_result(history)
    has_real = bool(upcoming) or bool(history)

    out = {
        "updated": today,
        "sample": (not has_real),
        "upcoming": upcoming,
        "latest_result": latest_result,
        "history": history,
    }
    os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    nxt = upcoming["report"] + " " + upcoming["date"] if upcoming else "none scheduled"
    print(f"[whats-priced-in] upcoming={nxt} | history={len(history)} rows | "
          f"sample={out['sample']} -> wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
