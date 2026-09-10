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

# ONE DEFINITION OF "IN LINE", shared with build_analyst_scorecard.py. The two
# used to carry their own copies and disagreed on one screen about one number:
# 2026/27 corn yield read BULLISH in the track record and IN LINE in the graded
# calls, same consensus, same print. See scripts/report_bands.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_bands import surprise as band_surprise, gap_pct as band_gap_pct  # noqa: E402

EST_PATH  = "data/wpi-estimates.json"
HIST_PATH = "data/wpi-history.json"
OUT_PATH  = "data/whats-priced-in.json"
COT_PATH  = "data/cot.json"
# The bands moved to scripts/report_bands.py on 2026-09-10, unchanged, so the
# scorecard could apply the same ones. The 2026-08-11 reasoning for why a yield
# gets a tighter band than a stocks figure is in that file's header.

UPCOMING_FIELDS = ["report", "date", "time", "commodity", "metric", "expectation",
                   "estimate_low", "estimate_high", "estimate_avg", "unit",
                   "implied_odds", "bullish_threshold", "bearish_threshold",
                   "positioning"]
HISTORY_FIELDS  = ["date", "report", "metric", "expected", "actual", "unit",
                   "surprise", "reaction"]

# WHICH COMMODITIES A REPORT IS ABOUT, read off the words the author wrote in
# `commodity` rather than a second field to keep in step. The keys are the ones
# data/cot.json uses.
COT_KEYS = [("corn", "corn", "Corn"), ("beans", "soybean", "Soybeans"),
            ("wheat", "wheat", "Wheat")]


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


def cot_positioning(commodity_text, cot):
    """Where the money is sitting going into this report, from the last COT.

    THE PAGE HAS PROMISED THIS SINCE IT WAS BUILT. Its own FAQ says positioning
    comes from the weekly Commitments of Traders, `upcoming.positioning` has
    never once been filled by hand, and the block was hidden with no
    explanation — so the answer to "what does the FAQ mean" was nothing at all.
    data/cot.json is fetched every week and was three days old when this was
    written.

    NOTHING HERE IS INFERRED. The net position, the week-on-week change and the
    52-week extremes are all fields in that file; the sentence states the report
    date the CFTC put on them, because a position is only a fact about the
    Tuesday it was taken.
    """
    if not cot:
        return None
    text = str(commodity_text or "").lower()
    parts = []
    for key, word, label in COT_KEYS:
        if word not in text:
            continue
        c = cot.get(key) or {}
        net, prev = c.get("net"), c.get("prev")
        if net is None:
            continue
        side = "net long" if net > 0 else "net short" if net < 0 else "flat"
        bit = "%s %s %s contracts" % (label, side, f"{abs(net):,}")
        if prev is not None:
            move = net - prev
            if move:
                bit += ", %s %s on the week" % ("up" if move > 0 else "down", f"{abs(move):,}")
        # `max52` and `min52` are the extremes of the window the file covers, so
        # "no week in it was higher" is what the equality means — not a record.
        if c.get("max52") is not None and net == c["max52"]:
            bit += " and the biggest of the last 52 weeks"
        elif c.get("min52") is not None and net == c["min52"]:
            bit += " and the smallest of the last 52 weeks"
        parts.append(bit)
    if not parts:
        return None
    when = cot.get("report_date")
    return ("Managed money: " + "; ".join(parts) + "."
            + (" CFTC Commitments of Traders, positions as of %s." % when if when else ""))


def build_upcoming(reports, today, cot=None):
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
    # The one block that can fill itself.
    if not out.get("positioning"):
        out["positioning"] = cot_positioning(out.get("commodity"), cot)

    # ── AND WHAT IS MISSING SAYS SO ──────────────────────────────────────
    #
    # Four blocks of this card — the trade range, the implied odds, the
    # bullish/bearish thresholds and the positioning line — were each hidden by
    # a falsy check with nothing rendered in their place. On 2026-09-10, the day
    # before a WASDE, that meant the card carried a heading, a date and one
    # sentence of prose, and a reader had no way to tell whether the trade
    # survey had not published, had not been collected, or had been withheld.
    #
    # Standing rule 20: a silent withholding is worse than a refusal. Each gap
    # now carries the reason it is a gap, and the page prints it where the block
    # would have been.
    out["withheld"] = {}
    if lo is None or hi is None or (hi is not None and lo is not None and hi <= lo):
        out["withheld"]["range"] = (
            "No pre-report trade survey is on file for this report yet. The survey "
            "usually publishes one to two days ahead of the release; the range is "
            "typed in from it and is never estimated here.")
    if not out["implied_odds"]:
        out["withheld"]["odds"] = (
            "No prediction market is quoting this report. When one is, its odds "
            "appear here with the venue named.")
    if not out.get("bullish_threshold") and not out.get("bearish_threshold"):
        out["withheld"]["thresholds"] = (
            "The thresholds are the ends of the trade range, so they arrive with it.")
    if not out.get("positioning"):
        out["withheld"]["positioning"] = (
            "No Commitments of Traders file covering this report's commodities "
            "could be read.")
    return out


def score(expected, actual, metric=""):
    """The shared rule. Returns "" when there was nothing to compare against —
    which used to return "in line", telling a reader that a print nobody had an
    estimate for landed where the trade expected it."""
    return band_surprise(expected, actual, metric)


def build_history(rows):
    out = []
    for r in rows:
        row = {k: r.get(k) for k in HISTORY_FIELDS}
        if not row.get("surprise"):
            row["surprise"] = score(r.get("expected"), r.get("actual"), r.get("metric") or r.get("label") or "")
        # HOW FAR OFF, ON EVERY ROW. This was computed for the one report in the
        # result banner and nowhere else, so the track record showed "765 -> 744"
        # and left the reader to do the arithmetic on thirteen rows.
        row["gap_pct"] = band_gap_pct(r.get("expected"), r.get("actual"))
        out.append(row)
    # newest first
    out.sort(key=lambda x: x.get("date") or "", reverse=True)
    return out


def _gap_pct(expected, actual):
    return band_gap_pct(expected, actual)


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

    cot = None
    if os.path.exists(COT_PATH):
        try:
            cot = json.load(open(COT_PATH))
        except Exception as ex:
            print("[whats-priced-in] could not read %s (%s)" % (COT_PATH, type(ex).__name__))
    upcoming = build_upcoming(reports, today, cot)
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
