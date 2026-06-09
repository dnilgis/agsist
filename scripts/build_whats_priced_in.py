#!/usr/bin/env python3
"""
build_whats_priced_in.py  -  AGSIST "what's priced in" pipeline.

Assembles data/whats-priced-in.json (what /whats-priced-in reads) from four inputs.
Three are automated from data you already have; one is a small manual file you keep.

ADAPTER POINTS (wire these to your existing data):
  1. next_report()      -> read your USDA report calendar, return the next report
                           {report, date (YYYY-MM-DD), time, commodity}.
  2. implied_odds()     -> read your ag-odds / prediction-market data, return a list of
                           {label, pct} buckets for the report's headline metric.
  3. positioning()      -> read your COT data, return a one-line net-position summary.

MANUAL INPUT (the one human step, by design):
  data/wpi-estimates.json  -- you enter the pre-report trade estimate per release:
    {
      "2026-06-11": {
        "metric": "2026/27 US corn ending stocks",
        "estimate_low": 1.62, "estimate_high": 1.98, "estimate_avg": 1.80, "unit": "bil bu",
        "expectation": "Trade looks for ...",
        "bullish_threshold": "below ~1.65 bil bu",
        "bearish_threshold": "above ~1.92 bil bu"
      }
    }
  After the report, move that release into data/wpi-history.json with the actual + reaction,
  and this script appends it to the page's track record.
"""

import json
import os
import datetime as dt

HERE = os.path.dirname(__file__)
DATA_PATH = os.path.join(HERE, "..", "data", "whats-priced-in.json")
EST_PATH = os.path.join(HERE, "..", "data", "wpi-estimates.json")
HIST_PATH = os.path.join(HERE, "..", "data", "wpi-history.json")


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


# ---- ADAPTER POINTS -------------------------------------------------------
def next_report():
    """Return the next scheduled report dict, or None. Wire to your USDA calendar."""
    raise NotImplementedError("Wire next_report() to your USDA report calendar data.")


def implied_odds(report_date):
    """Return a list of {label, pct}. Wire to your ag-odds / prediction-market data."""
    return []


def positioning(commodity):
    """Return a one-line fund-positioning summary. Wire to your COT data."""
    return ""
# ---------------------------------------------------------------------------


def build():
    nxt = next_report()
    upcoming = None
    if nxt:
        est = _load(EST_PATH, {}).get(nxt["date"], {})
        upcoming = {
            "report": nxt.get("report"),
            "date": nxt.get("date"),
            "time": nxt.get("time", ""),
            "commodity": nxt.get("commodity", ""),
            "metric": est.get("metric", ""),
            "expectation": est.get("expectation", ""),
            "estimate_low": est.get("estimate_low"),
            "estimate_high": est.get("estimate_high"),
            "estimate_avg": est.get("estimate_avg"),
            "unit": est.get("unit", ""),
            "implied_odds": implied_odds(nxt["date"]),
            "positioning": positioning(nxt.get("commodity", "")),
            "bullish_threshold": est.get("bullish_threshold", ""),
            "bearish_threshold": est.get("bearish_threshold", ""),
        }

    history = sorted(_load(HIST_PATH, []), key=lambda r: r.get("date", ""), reverse=True)

    return {
        "updated": dt.date.today().isoformat(),
        "sample": False,
        "upcoming": upcoming,
        "history": history,
    }


def main():
    out = build()
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {DATA_PATH}")


if __name__ == "__main__":
    main()
