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
from datetime import datetime, timezone, date as _date

# ONE DEFINITION OF "IN LINE", shared with build_analyst_scorecard.py. The two
# used to carry their own copies and disagreed on one screen about one number:
# 2026/27 corn yield read BULLISH in the track record and IN LINE in the graded
# calls, same consensus, same print. See scripts/report_bands.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_bands import surprise as band_surprise, gap_pct as band_gap_pct  # noqa: E402

EST_PATH  = "data/wpi-estimates.json"
ANALYST_PATH = "data/analyst-estimates.json"
HIST_PATH = "data/wpi-history.json"
OUT_PATH  = "data/whats-priced-in.json"
COT_PATH  = "data/cot.json"
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
def build_report_numbers(upcoming, path=ANALYST_PATH):
    """Every metric on the upcoming report, one row each, ready to render.

    Returns [] when the file is absent or carries no matching report. An empty
    list is a real answer and the page says so in words; it is never padded.
    """
    if not upcoming:
        return []
    try:
        with open(path) as f:
            book = json.load(f)
    except (OSError, ValueError):
        return []

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

        rows.append({
            "key": m.get("key"),
            "label": label,
            "unit": m.get("unit") or "",
            "expected": exp,
            "low": lo,
            "high": hi,
            "usda_current": m.get("usda_current"),
            "actual": act,
            "surprise": band_surprise(exp, act, label),
            "gap_pct": band_gap_pct(exp, act),
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
def calendar_fallback(today):
    """The next WASDE from the shipped calendar, as a minimal report row."""
    try:
        import usda_dates
    except ImportError:
        return None
    try:
        nxt = usda_dates.next_wasde(_date.fromisoformat(today))
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

def build_upcoming(reports, today, cot=None):
    future = sorted((r for r in reports if (r.get("date") or "") >= today),
                    key=lambda r: r["date"])
    if not future:
        fb = calendar_fallback(today)
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
    if upcoming:
        upcoming["numbers"] = build_report_numbers(upcoming)
    history = build_history(hist_rows)
    latest_result = build_latest_result(history)

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
        assert by["d"]["why"] != by["e"]["why"]

        # a date with no report in the book is an empty list, never a guess
        assert build_report_numbers({"date": "1999-01-01"}, path) == []
        assert build_report_numbers(None, path) == []
        assert build_report_numbers({"date": "2026-09-11"}, "/nonexistent.json") == []
    finally:
        _os.unlink(path)

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
    global ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH
    keep = (ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH)
    try:
        ANALYST_PATH = paths["analyst-estimates.json"]
        HIST_PATH = paths["wpi-history.json"]
        EST_PATH = paths["wpi-estimates.json"]
        OUT_PATH = _os.path.join(d, "out.json")
        COT_PATH = _os.path.join(d, "no-cot.json")
        main()
        built = json.load(open(OUT_PATH))
    finally:
        ANALYST_PATH, HIST_PATH, EST_PATH, OUT_PATH, COT_PATH = keep

    lr = built["latest_result"]
    assert lr and lr["date"] == "2026-09-11"
    nums = lr.get("numbers") or []
    assert len(nums) == 2, ("the graded report's walk-through must ride with the "
                            "result banner, not the next card: got %r" % (nums,))
    got = {r["key"]: (r["actual"], r["surprise"]) for r in nums}
    assert got["corn_yield_2627"] == (178.5, "in line"), got
    assert got["soy_yield_2627"] == (52.8, "bearish"), got
    # and the September rows are NOT also hanging off October's card, which
    # would put the same figures under the wrong report's heading.
    assert built["upcoming"]["date"] != "2026-09-11"
    assert (built["upcoming"].get("numbers") or []) == [], \
        "the next report has no numbers until its own survey is typed in"

    print("[whats-priced-in] selftest ok: 5 rows, 3 verdicts, 2 kinds of silence, "
          "the card falls back to the calendar, and the walk-through outlives the print")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        main()
