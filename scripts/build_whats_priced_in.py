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
  • Grades every history row from expected vs. actual with
    scripts/report_bands.py (the distance from the trade average against a
    band per kind of number; the range is printed as context). A hand-typed
    `surprise` in wpi-history.json is ignored since 2026-10-10: one rule, every
    row, or the track record and the scorecard disagree again.
  • Refuses to build (report_bands.consensus_lock) when a trade average, low
    or high is not dated before its report.
  • Sets `sample` to false whenever any real report/history is present, so
    the page's "illustrative" ribbon turns itself off.

Stdlib only. No secrets, no network. Safe to run on every push + daily cron.
"""
import json
import re
import os
import sys
from datetime import datetime, timezone, timedelta, date as _date

# ONE DEFINITION OF "IN LINE", shared with build_analyst_scorecard.py. The two
# used to carry their own copies and disagreed on one screen about one number:
# 2026/27 corn yield read BULLISH in the track record and IN LINE in the graded
# calls, same consensus, same print. See scripts/report_bands.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_bands import surprise as band_surprise, gap_pct as band_gap_pct  # noqa: E402
from report_bands import range_context, consensus_lock, ConsensusLockError, RULE_CHANGED  # noqa: E402

EST_PATH  = "data/wpi-estimates.json"
ANALYST_PATH = "data/analyst-estimates.json"
HIST_PATH = "data/wpi-history.json"
OUT_PATH  = "data/whats-priced-in.json"
COT_PATH  = "data/cot.json"
WASDE_PATH = "data/wasde.json"
# The bands moved to scripts/report_bands.py on 2026-09-10, unchanged, so the
# scorecard could apply the same ones. The 2026-08-11 reasoning for why a yield
# gets a tighter band than a stocks figure is in that file's header.

UPCOMING_FIELDS = ["report", "date", "time", "commodity", "metric", "expectation",
                   "estimate_low", "estimate_high", "estimate_avg", "unit",
                   "implied_odds", "bullish_threshold", "bearish_threshold",
                   # from_calendar marks a card built from the shipped WASDE
                   # calendar rather than from a researched report row. Without
                   # it in this list the marker is dropped here and a reader of
                   # the JSON cannot tell a placeholder from the real thing.
                   "positioning", "from_calendar"]
HISTORY_FIELDS  = ["date", "report", "metric", "expected", "actual", "unit",
                   "surprise", "reaction"]


def load_book(path=None):
    """data/analyst-estimates.json, checked by the lock. {} when absent.

    A trade average, low or high whose source is not dated before the report
    stops the build here, loudly, naming every one. That is what kept October's
    after-the-report ranges from deciding grades."""
    try:
        with open(path or ANALYST_PATH) as f:
            book = json.load(f)
    except (OSError, ValueError):
        return {}
    try:
        consensus_lock(book)
    except ConsensusLockError as e:
        sys.exit("[whats-priced-in] REFUSED: %s" % e)
    return book


def book_meta(book):
    """{(date, label): {direction, source_date_unknown}} for every metric."""
    try:
        status = consensus_lock(book)
    except ConsensusLockError:
        status = {}
    out = {}
    for rpt in (book or {}).get("reports") or []:
        for m in rpt.get("metrics") or []:
            k = (rpt.get("date"), m.get("label"))
            out[k] = {"direction": m.get("direction") or "supply",
                      "source_date": m.get("consensus_source_date"),
                      "source_date_unknown": status.get(k) == "unknown"}
    return out

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



# ── EVERY NUMBER ON THE REPORT, NOT JUST THE HEADLINE ────────────────────────
#
# Sig, 2026-09-11, after reading the page on WASDE morning: "it only showed
# corn, i want to walk people through the numbers when released, more
# informative without getting messy."
#
# The card above stays exactly as it is: one metric, one range bar, the odds and
# the thresholds. That is the pre-report focus and it is not improved by being
# four of everything. What was missing is the part AFTER the print, when a
# grower wants the whole report on one line each.
#
# WHERE THESE COME FROM, AND WHY NOT A NEW FILE. data/analyst-estimates.json
# already carries every metric on the report with its consensus, the survey's
# own high and low, USDA's standing figure, a source URL and a note saying who
# published the survey and when. The WASDE watcher writes `actual` into that
# same file the moment the print lands. So the numbers, their provenance and
# their result already live in one place, and this reads it rather than asking
# anybody to keep a second list in step. Two files carrying the same figure is
# how a page ends up disagreeing with itself in front of a reader.
#
# NOTHING IS COMPUTED TWICE. The bullish / bearish / in-line verdict comes from
# report_bands.surprise, the same function the scorecard and the track record
# use. A third implementation of "in line" is how one screen once called a print
# BULLISH and another called it IN LINE off the same two numbers.
def build_report_numbers(upcoming, path=None):
    """Every metric on the upcoming report, one row each, ready to render.

    Returns [] when the file is absent or carries no matching report. An empty
    list is a real answer and the page says so in words; it is never padded.
    """
    if not upcoming:
        return []
    # Resolved at CALL time. A default of path=ANALYST_PATH was bound when the
    # module loaded, so the selftest's end-to-end main() run -- which points
    # ANALYST_PATH at a temp file -- was silently reading the real repo file,
    # and passed only while that file happened to hold the same two rows.
    book = load_book(path or ANALYST_PATH)
    if not book:
        return []
    status = consensus_lock(book)

    date = upcoming.get("date")
    rpt = next((r for r in (book.get("reports") or []) if r.get("date") == date), None)
    if not rpt:
        return []

    rows = []
    for m in rpt.get("metrics") or []:
        label = m.get("label")
        if not label:
            continue
        exp, act = m.get("consensus"), m.get("actual")
        rng = m.get("consensus_range") or []
        lo, hi = (rng + [None, None])[:2]

        # A MISSING VALUE GETS A REASON, NOT A BLANK AND NOT A ZERO.
        # Before the print, `actual` is null for an ordinary reason and the page
        # must say which one rather than leave a reader guessing whether the
        # number was withheld.
        if act is None:
            why = "not printed yet"
        elif exp is None:
            why = "no trade estimate was published for this one"
        else:
            why = ""
        # AND THE TRADE COLUMN GETS ITS OWN REASON. A report typed in before its
        # survey publishes (October 2026, carried so the model's locked calls
        # can sit on the board) would otherwise print a bare dash under "Trade
        # expects".
        if exp is not None:
            exp_why = ""
        elif act is None:
            exp_why = "no trade survey on file yet"
        else:
            exp_why = "no trade estimate published"

        direction = m.get("direction") or "supply"
        rows.append({
            "key": m.get("key"),
            "label": label,
            "unit": m.get("unit") or "",
            "expected": exp,
            "expected_why": exp_why,
            "low": lo,
            "high": hi,
            "usda_current": m.get("usda_current"),
            "actual": act,
            # the distance from the trade average against the band for this
            # kind of number (report_bands); the range is context, below
            "surprise": band_surprise(exp, act, label, lo, hi, direction),
            "gap_pct": band_gap_pct(exp, act),
            "context": range_context(act, lo, hi),
            "source_date": m.get("consensus_source_date"),
            # the lock let it through only because the entry predates the
            # rule; the page says "source date unknown" beside it
            "source_date_unknown": status.get((date, label)) == "unknown",
            "why": why,
            "source": m.get("consensus_source"),
            "source_note": m.get("consensus_note"),
        })
    return rows


# ── THE CARD MUST NEVER GO BLANK BECAUSE A LIST RAN OUT ──────────────────────
#
# Found 2026-09-12. data/wpi-estimates.json held exactly one report, the
# September WASDE, and its date had passed. At the next 11:20 UTC build
# build_upcoming would have returned None and the top of the flagship page would
# have read "No upcoming report is scheduled right now" -- on a site whose whole
# proposition is knowing what is coming. Nothing was broken; a hand-maintained
# list had simply reached its end, silently, on a schedule.
#
# Adding October fixed that day and moved the cliff to 10 October. This removes
# the cliff. scripts/usda_dates.py already carries WASDE_2026, every release
# date for the year, and it is the same table the WASDE watcher gates on. When
# the estimates file has nothing dated today or later, the next date is read
# from that table and rendered as a card with no figures on it.
#
# WHAT THE FALLBACK CARD SAYS. Only the things that are known without a survey:
# the report's name, its date, and the 12:00 PM ET release time every WASDE
# keeps. Every other block -- the range, the odds, the thresholds -- goes
# through the existing `withheld` path, which already prints why it is absent.
# No figure is invented, and `from_calendar` marks the card so a reader of the
# JSON can tell a scheduled placeholder from a report somebody has researched.
def calendar_fallback(today, released=()):
    """The next WASDE from the shipped calendar, as a minimal report row.
    A WASDE dated today that has already printed is not "next"."""
    try:
        import usda_dates
    except ImportError:
        return None
    try:
        nxt = usda_dates.next_wasde(_date.fromisoformat(today))
        if nxt and nxt.isoformat() in released:
            nxt = usda_dates.next_wasde(nxt + timedelta(days=1))
    except (AttributeError, ValueError):
        return None
    if not nxt:
        return None
    return {
        "report": nxt.strftime("%B") + " WASDE",
        "date": nxt.isoformat(),
        "time": "12:00 PM ET",
        "from_calendar": True,
    }

def released_dates(history, wasde=None):
    """Report dates that have printed: any history row with a USDA figure, plus
    the release data/wasde.json records once the watcher has read it.

    ON REPORT DAY THE CARD ROLLS AT THE PRINT, NOT AT MIDNIGHT. `upcoming` was
    the first report dated today or later, so on 2026-10-09 the October card,
    with its pre-report wording and its own copy of the numbers table, sat
    above the result banner until 00:00 UTC. Once the print is on file the next
    report is what is coming."""
    out = {str(r.get("date")) for r in (history or [])
           if r.get("date") and r.get("actual") is not None}
    if wasde and wasde.get("release"):
        out.add(str(wasde["release"])[:10])
    return out


def build_upcoming(reports, today, cot=None, released=()):
    future = sorted((r for r in reports
                     if (r.get("date") or "") >= today and r.get("date") not in released),
                    key=lambda r: r["date"])
    if not future:
        fb = calendar_fallback(today, released)
        if not fb:
            return None
        future = [fb]
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
    #
    # WHICH COMMODITIES, NOT WHICH BAR. `commodity` names what the range bar
    # measures. It was ALSO the string this searched for "corn" / "soybean" /
    # "wheat" in, which quietly made the two one decision. On 2026-09-11 the
    # September WASDE card was relabelled "Corn" so its heading would stop
    # naming four quantities above a bar that measured one -- and the soybean
    # fund-positioning line vanished from the card on WASDE morning, because a
    # label edit had silently reselected the data.
    #
    # `positioning_commodities` says which series to show, independently of what
    # the bar is measuring. Absent, it falls back to `commodity`, so every
    # report that does not set it behaves exactly as before.
    if not out.get("positioning"):
        out["positioning"] = cot_positioning(
            r.get("positioning_commodities") or out.get("commodity"), cot)

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


def survey_ranges(path=None):
    """{(date, metric label): (low, high)} from data/analyst-estimates.json.

    The track record rows in wpi-history.json carry the average but not the
    survey's low and high. Those already live in analyst-estimates.json, typed
    from the survey once; they are read from there rather than copied, so a
    print is graded against the same range the report card showed."""
    try:
        with open(path or ANALYST_PATH) as f:
            book = json.load(f)
    except (OSError, ValueError):
        return {}
    out = {}
    for rpt in book.get("reports") or []:
        for m in rpt.get("metrics") or []:
            rng = m.get("consensus_range") or []
            if m.get("label") and len(rng) == 2 and None not in rng:
                out[(rpt.get("date"), m["label"])] = (rng[0], rng[1])
    return out


def plain_dashes(text):
    """A typed reaction's em dashes become commas. The report-day email and the
    page both print this text, and the house style has no em dashes."""
    if not isinstance(text, str):
        return text
    return re.sub(r"\s*\u2014\s*", ", ", text).strip(", ")


def build_history(rows, ranges=None, meta=None):
    ranges = ranges or {}
    meta = meta or {}
    out = []
    for r in rows:
        row = {k: r.get(k) for k in HISTORY_FIELDS}
        row["reaction"] = plain_dashes(row.get("reaction"))
        label = r.get("metric") or r.get("label") or ""
        lo, hi = ranges.get((r.get("date"), label), (None, None))
        row["low"], row["high"] = lo, hi
        mt = meta.get((r.get("date"), label)) or {}
        # EVERY ROW, ONE RULE (2026-10-10). A typed `surprise` is not honoured:
        # none of the rows on file carried one, and an override is a second
        # definition of "in line" waiting to disagree with the scorecard.
        row["surprise"] = band_surprise(r.get("expected"), r.get("actual"), label, lo, hi,
                                        mt.get("direction") or "supply")
        row["context"] = range_context(r.get("actual"), lo, hi)
        # A ROW WITH NO DATED SOURCE SAYS SO. The May 2026 rows were typed from
        # surveys nobody filed in analyst-estimates.json, so nothing shows they
        # came before the print; they stay on the record, flagged.
        row["source_date_unknown"] = (r.get("expected") is not None
                                      and (not mt or mt.get("source_date_unknown", True)))
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
        enriched.append({**{k: r.get(k) for k in HISTORY_FIELDS}, "gap_pct": gp,
                         "context": r.get("context") or "",
                         "low": r.get("low"), "high": r.get("high")})
    # ONLY A GRADED ROW COUNTS (2026-10-06). The empty string is report_bands'
    # "no trade estimate to compare against", and it was falling through
    # `not in ("in line", None)` into the surprise list -- the September Grain
    # Stocks wheat row, which nobody surveyed, could be picked as the report's
    # "biggest surprise", and metric_count put it in the denominator of
    # "1 of 3 figures landed in line". A figure nobody graded is neither.
    graded = [r for r in enriched if r.get("surprise") in ("bullish", "bearish", "in line")]
    surprises = [r for r in graded if r.get("surprise") != "in line"]
    biggest = max(surprises, key=lambda r: abs(r.get("gap_pct") or 0)) if surprises else None
    in_line = sum(1 for r in graded if r.get("surprise") == "in line")
    return {
        "date": latest_date,
        "report": rows[0].get("report") if rows else "",
        # metric_count is the GRADED count, the denominator the banner prints.
        "metric_count": len(graded),
        "ungraded_count": len(enriched) - len(graded),
        "in_line_count": in_line,
        # all in line only when every GRADED row sat inside its band
        "all_in_line": bool(graded) and (in_line == len(graded)),
        "biggest_surprise": biggest,
        "rule_changed": RULE_CHANGED,
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
    book = load_book()          # exits here, loudly, if the lock refuses
    wasde = None
    if os.path.exists(WASDE_PATH):
        try:
            wasde = json.load(open(WASDE_PATH))
        except Exception as ex:
            print("[whats-priced-in] could not read %s (%s)" % (WASDE_PATH, type(ex).__name__))
    history = build_history(hist_rows, survey_ranges(), book_meta(book))
    latest_result = build_latest_result(history)
    upcoming = build_upcoming(reports, today, cot, released_dates(history, wasde))
    if upcoming:
        upcoming["numbers"] = build_report_numbers(upcoming)

    # ── THE WALK-THROUGH HAS TO OUTLIVE THE REPORT IT WALKS THROUGH ──────
    #
    # Found 2026-09-12, reading the run that finally graded the September
    # print. `numbers` was attached to `upcoming` only, and `upcoming` is the
    # next report dated today or later. So the strip filled in with actuals at
    # 16:05 UTC on release day and emptied at 00:00 UTC, roughly seven hours
    # later -- and this September it never filled at all, because NASS refused
    # for two days and by the time the grade landed the card had already
    # flipped to October. Sig asked to "walk people through the numbers when
    # released"; the strip was showing them only before the release.
    #
    # The result banner already has the right lifetime: it runs from report day
    # to five days after. Attaching the same rows to it puts the walk-through
    # where a grower goes looking for it, for as long as they are looking.
    #
    # SAME FUNCTION, SAME FILE, NO SECOND LIST. build_report_numbers keys off a
    # date, and latest_result carries the date of the report it summarises.
    if latest_result:
        latest_result["numbers"] = build_report_numbers(latest_result)
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



def _selftest():
    """Hand-worked answers for build_report_numbers. The page renders these
    rows and computes nothing, so this is the only place the arithmetic is
    checked."""
    import tempfile, os as _os
    book = {"reports": [{"report": "Test WASDE", "date": "2026-09-11", "metrics": [
        # printed BELOW the trade estimate, well outside the yield band -> bullish
        {"key": "a", "label": "2026/27 corn yield", "unit": "bu/acre",
         "consensus": 178.1, "consensus_range": [173.2, 182.9],
         "usda_current": 180.7, "actual": 173.0, "consensus_source": "u"},
        # printed ABOVE -> bearish
        {"key": "b", "label": "2026/27 soybean yield", "unit": "bu/acre",
         "consensus": 52.5, "consensus_range": [51.5, 53.3],
         "usda_current": 52.7, "actual": 54.0},
        # dead on -> in line
        {"key": "c", "label": "2026/27 wheat ending stocks", "unit": "mil bu",
         "consensus": 800, "actual": 800},
        # not printed yet -> no verdict, and a reason in words
        {"key": "d", "label": "2026/27 corn ending stocks", "unit": "mil bu",
         "consensus": 2100, "actual": None},
        # printed, but nobody surveyed it -> no verdict, different reason
        {"key": "e", "label": "2026/27 sorghum production", "unit": "mil bu",
         "consensus": None, "actual": 370},
        # no label at all is not a row
        {"key": "f", "unit": "mil bu", "consensus": 1, "actual": 2},
    ]}]}
    fd, path = tempfile.mkstemp(suffix=".json"); _os.close(fd)
    with open(path, "w") as f:
        json.dump(book, f)
    try:
        rows = build_report_numbers({"date": "2026-09-11"}, path)
        assert len(rows) == 5, f"a metric with no label is not a row: got {len(rows)}"
        by = {r["key"]: r for r in rows}

        # 173.0 vs 178.1 is -2.86%, past the 0.5% yield band, and below -> bullish
        assert by["a"]["surprise"] == "bullish", by["a"]["surprise"]
        assert by["a"]["gap_pct"] == -2.9, by["a"]["gap_pct"]
        assert by["a"]["low"] == 173.2 and by["a"]["high"] == 182.9
        assert by["a"]["why"] == ""

        assert by["b"]["surprise"] == "bearish", by["b"]["surprise"]
        assert by["c"]["surprise"] == "in line", by["c"]["surprise"]
        assert by["c"]["low"] is None and by["c"]["high"] is None, "an absent range is None, never 0"

        # THE TWO SILENCES ARE DIFFERENT AND MUST READ DIFFERENTLY.
        # Both print no verdict. One is "the report has not landed", the other
        # is "nobody forecast this". A reader told the same thing twice cannot
        # tell which, and would reasonably assume the print was unremarkable.
        assert by["d"]["surprise"] == "" and by["d"]["why"] == "not printed yet"
        assert by["e"]["surprise"] == "" and "no trade estimate" in by["e"]["why"]
        # the trade column carries its own reason when there is no estimate
        assert by["e"]["expected_why"] == "no trade estimate published"
        assert by["a"]["expected_why"] == "" and by["d"]["expected_why"] == ""
        assert by["d"]["why"] != by["e"]["why"]

        # a date with no report in the book is an empty list, never a guess
        assert build_report_numbers({"date": "1999-01-01"}, path) == []
        assert build_report_numbers(None, path) == []
        assert build_report_numbers({"date": "2026-09-11"}, "/nonexistent.json") == []
    finally:
        _os.unlink(path)

    # ── THE AVERAGE GRADES, THE RANGE IS CONTEXT (2026-10-10) ───────────────
    # September 2026 Grain Stocks soybeans: average 0.324, range 0.304-0.349,
    # print 0.315. -2.8% clears the 2% band: bullish, inside the range near the
    # bottom. From 2026-10-03 to 2026-10-09 this read "in line".
    rk = {("2026-09-30", "Soybean stocks, all positions, Sept 1"): (0.304, 0.349),
          ("2026-09-30", "Corn stocks, all positions, Sept 1"): (1.843, 2.005)}
    h = {x["metric"]: x for x in build_history([
        {"date": "2026-09-30", "metric": "Soybean stocks, all positions, Sept 1", "expected": 0.324, "actual": 0.315},
        {"date": "2026-09-30", "metric": "Corn stocks, all positions, Sept 1", "expected": 1.918, "actual": 2.095},
        {"date": "2026-06-11", "metric": "2026/27 wheat ending stocks", "expected": 765, "actual": 744}], rk)}
    soy = h["Soybean stocks, all positions, Sept 1"]
    assert soy["surprise"] == "bullish", h
    assert soy["context"] == "inside the range, near the bottom", soy
    assert soy["low"] == 0.304
    assert h["Corn stocks, all positions, Sept 1"]["surprise"] == "bearish"
    assert h["Corn stocks, all positions, Sept 1"]["context"] == "outside the trade range"
    # no range on file: no context, and the 2% band decides (765 -> 744 is -2.7%)
    assert h["2026/27 wheat ending stocks"]["surprise"] == "bullish" and h["2026/27 wheat ending stocks"]["low"] is None
    assert h["2026/27 wheat ending stocks"]["context"] == ""
    # with no metadata at all, nothing shows the survey came first: flagged
    assert all(x["source_date_unknown"] for x in h.values())
    # a typed surprise is not honoured: one rule for every row
    typed = build_history([{"date": "2026-10-09", "metric": "2026/27 corn yield",
                            "expected": 177.8, "actual": 181.2, "surprise": "in line"}],
                          {("2026-10-09", "2026/27 corn yield"): (173.2, 182.1)},
                          {("2026-10-09", "2026/27 corn yield"): {"direction": "supply",
                                                                 "source_date_unknown": False}})
    assert typed[0]["surprise"] == "bearish" and typed[0]["context"] == "inside the range, near the top", typed
    assert typed[0]["source_date_unknown"] is False
    # a demand metric reads the other way round
    dem = build_history([{"date": "2026-10-09", "metric": "2026/27 corn exports", "expected": 100, "actual": 110}],
                        None, {("2026-10-09", "2026/27 corn exports"): {"direction": "demand",
                                                                       "source_date_unknown": False}})
    assert dem[0]["surprise"] == "bullish", dem
    # ── THE BANNER COUNTS ONLY WHAT WAS GRADED ──────────────────────────────
    # The real September Grain Stocks shape: one bearish, one in line, one with
    # no trade estimate. The ungraded row is neither a surprise nor in line.
    lr = build_latest_result(build_history([
        {"date": "2026-09-30", "metric": "Corn stocks, all positions, Sept 1", "expected": 1.918, "actual": 2.095},
        {"date": "2026-09-30", "metric": "Soybean stocks, all positions, Sept 1", "expected": 0.324, "actual": 0.315},
        {"date": "2026-09-30", "metric": "Wheat stocks, all positions, Sept 1", "expected": None, "actual": 1.846}], rk))
    assert lr["metric_count"] == 2 and lr["ungraded_count"] == 1 and lr["in_line_count"] == 0, lr
    assert lr["biggest_surprise"]["metric"].startswith("Corn") and not lr["all_in_line"]
    # THE REAL OCTOBER SHAPE: 7 graded, 1 ungraded, 3 in line, 4 bearish. Every
    # one of the 7 is inside its range; "all in line" is now false.
    oct_rows = [("2026/27 corn yield", 177.8, 181.2, 173.2, 182.1),
                ("2026/27 soybean yield", 52.9, 53.1, 51.4, 54.1),
                ("2026/27 corn ending stocks", 1.677, 1.849, 1.522, 1.895),
                ("2026/27 soybean ending stocks", 311, 315, 245, 358),
                ("2026/27 wheat ending stocks", 722, 740, 701, 750),
                ("2026/27 corn production", 15.716, 16.034, 15.344, 16.115),
                ("2026/27 soybean production", 4541, 4562, 4415, 4648),
                ("2026/27 wheat production", None, 1534, None, None)]
    lro = build_latest_result(build_history(
        [{"date": "2026-10-09", "report": "October WASDE", "metric": m, "expected": e, "actual": a}
         for m, e, a, _l, _h in oct_rows],
        {("2026-10-09", m): (l, hh) for m, _e, _a, l, hh in oct_rows if l is not None}))
    assert (lro["metric_count"], lro["ungraded_count"], lro["in_line_count"], lro["all_in_line"]) == (7, 1, 3, False), lro
    # biggest by distance from the average: corn stocks, +10.3%
    assert lro["biggest_surprise"]["metric"] == "2026/27 corn ending stocks", lro["biggest_surprise"]
    assert lro["biggest_surprise"]["context"] == "inside the range, near the top"
    # nothing graded at all: no biggest surprise, and not "all in line"
    lr0 = build_latest_result(build_history([
        {"date": "2026-09-30", "metric": "Wheat stocks, all positions, Sept 1", "expected": None, "actual": 1.846}]))
    assert lr0["metric_count"] == 0 and lr0["ungraded_count"] == 1
    assert lr0["biggest_surprise"] is None and lr0["all_in_line"] is False, lr0

    real = survey_ranges()
    if real:
        assert real.get(("2026-09-30", "Soybean stocks, all positions, Sept 1")) == (0.304, 0.349), "the range is read, not retyped"

    # ── THE CARD NEVER GOES BLANK BECAUSE THE LIST RAN OUT ──────────────────
    reps = [{"report": "September WASDE", "date": "2026-09-11", "metric": "corn yield"}]

    # a report still ahead is used as-is and is NOT marked as a placeholder
    u = build_upcoming(reps, "2026-09-10")
    assert u["report"] == "September WASDE" and not u.get("from_calendar")

    # the day after the last one on file, the calendar takes over
    u = build_upcoming(reps, "2026-09-12")
    assert u is not None, "the card must not go blank when the list runs out"
    assert u["report"] == "October WASDE" and u["date"] == "2026-10-09"
    assert u["from_calendar"] is True, "a placeholder must say so in the JSON"

    # and it carries NO figures. A placeholder that invents a range is worse
    # than an empty card, because a reader cannot tell it is a placeholder.
    for k in ("estimate_low", "estimate_avg", "estimate_high", "bullish_threshold"):
        assert u.get(k) is None, f"the fallback card must not carry {k}"
    assert u.get("withheld"), "and it must say in words why each block is missing"

    # an empty list behaves the same way as an exhausted one
    assert build_upcoming([], "2026-09-12")["report"] == "October WASDE"

    # past the calendar's horizon it returns None rather than inventing a date
    assert calendar_fallback("2027-06-01") is None
    assert build_upcoming([], "2027-06-01") is None

    # ── THE WALK-THROUGH SURVIVES THE PRINT ─────────────────────────────────
    #
    # This runs main() end to end against temporary files, because the bug it
    # guards was not in build_report_numbers -- which was right -- but in which
    # object main() hung the rows on. A unit test on the builder would have
    # passed on the day the strip was empty on the page.
    #
    # The setup is the real September shape: a report dated yesterday, already
    # graded, and nothing else on the list. That is exactly the state in which
    # `upcoming` flips to the calendar's next date and the walk-through used to
    # disappear.
    import tempfile as _tf, os as _o
    d = _tf.mkdtemp()
    graded = {"reports": [{"report": "September WASDE", "date": "2026-09-11", "metrics": [
        {"key": "corn_yield_2627", "label": "2026/27 corn yield", "unit": "bu/acre",
         "consensus": 178.1, "consensus_range": [173.2, 182.9],
         "usda_current": 180.7, "actual": 178.5, "consensus_source": "u"},
        {"key": "soy_yield_2627", "label": "2026/27 soybean yield", "unit": "bu/acre",
         "consensus": 52.5, "consensus_range": [51.5, 53.3],
         "usda_current": 52.7, "actual": 52.8},
    ]}]}
    hist = {"history": [
        {"date": "2026-09-11", "report": "September WASDE", "metric": "2026/27 corn yield",
         "expected": 178.1, "actual": 178.5, "unit": "bu/acre"},
        {"date": "2026-09-11", "report": "September WASDE", "metric": "2026/27 soybean yield",
         "expected": 52.5, "actual": 52.8, "unit": "bu/acre"},
    ]}
    paths = {}
    for name, blob in (("analyst-estimates.json", graded), ("wpi-history.json", hist),
                       ("wpi-estimates.json", {"reports": graded["reports"]})):
        paths[name] = _os.path.join(d, name)
        with open(paths[name], "w") as f:
            json.dump(blob, f)
    global ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH, WASDE_PATH
    keep = (ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH, WASDE_PATH)
    try:
        ANALYST_PATH = paths["analyst-estimates.json"]
        HIST_PATH = paths["wpi-history.json"]
        EST_PATH = paths["wpi-estimates.json"]
        OUT_PATH = _os.path.join(d, "out.json")
        COT_PATH = _os.path.join(d, "no-cot.json")
        WASDE_PATH = _os.path.join(d, "no-wasde.json")
        main()
        built = json.load(open(OUT_PATH))
    finally:
        ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH, WASDE_PATH = keep

    lr = built["latest_result"]
    assert lr and lr["date"] == "2026-09-11"
    nums = lr.get("numbers") or []
    assert len(nums) == 2, ("the graded report's walk-through must ride with the "
                            "result banner, not the next card: got %r" % (nums,))
    got = {r["key"]: (r["actual"], r["surprise"]) for r in nums}
    assert got["corn_yield_2627"] == (178.5, "in line"), got
    # 2026-10-10: 52.8 vs 52.5 is +0.57%, past the 0.5% yield band, so bearish.
    # (Range-first called it in line from 2026-10-03 to 2026-10-09.)
    assert got["soy_yield_2627"] == (52.8, "bearish"), got
    ctx = {r["key"]: r["context"] for r in nums}
    assert ctx["soy_yield_2627"] == "inside the range, near the top", ctx
    # and the September rows are NOT also hanging off October's card, which
    # would put the same figures under the wrong report's heading.
    assert built["upcoming"]["date"] != "2026-09-11"
    assert (built["upcoming"].get("numbers") or []) == [], \
        "the next report has no numbers until its own survey is typed in"

    # ── THE CARD ROLLS AT THE PRINT ─────────────────────────────────────────
    octrep = [{"report": "October WASDE", "date": "2026-10-09", "metric": "corn yield"}]
    # report morning, nothing printed: October is still next
    assert build_upcoming(octrep, "2026-10-09", released=set())["date"] == "2026-10-09"
    # printed (a history row, or wasde.json's release): November is next
    rel = released_dates([{"date": "2026-10-09", "actual": 181.2}])
    assert rel == {"2026-10-09"}
    u = build_upcoming(octrep, "2026-10-09", released=rel)
    assert u["date"] == "2026-11-10" and u["from_calendar"] is True, u
    assert released_dates([], {"release": "2026-10-09"}) == {"2026-10-09"}
    # a row with no USDA figure is not a release
    assert released_dates([{"date": "2026-11-10", "actual": None}]) == set()

    # ── THE LOCK STOPS THE BUILD ────────────────────────────────────────────
    bad = {"reports": [{"report": "November WASDE", "date": "2026-11-10", "metrics": [
        {"label": "2026/27 corn yield", "consensus": 181.0, "consensus_range": [179, 183]}]}]}
    fd, bp = tempfile.mkstemp(suffix=".json"); _os.close(fd)
    json.dump(bad, open(bp, "w"))
    try:
        load_book(bp)
        raise AssertionError("an undated November survey must stop the build")
    except SystemExit as e:
        assert "REFUSED" in str(e) and "2026-11-10" in str(e), e
    finally:
        _os.unlink(bp)
    # the real book passes, and every October figure is dated
    real_book = load_book()
    if real_book:
        meta = book_meta(real_book)
        assert meta[("2026-10-09", "2026/27 corn ending stocks")]["source_date"] == "2026-10-07"
        assert not meta[("2026-10-09", "2026/27 corn yield")]["source_date_unknown"]

    print("[whats-priced-in] selftest ok: 5 rows, 3 verdicts, 2 kinds of silence, "
          "the card falls back to the calendar, and the walk-through outlives the print")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        main()
