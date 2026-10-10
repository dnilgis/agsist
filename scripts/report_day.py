#!/usr/bin/env python3
"""
report_day.py -- the line the daily briefing carries on a USDA report day,
written by code, never by the model.

WHY. The Oct 9 2026 briefing's watch list did not mention the WASDE coming at
11 that morning. The prompt told the model it was a release day; the model
wrote three other watch items and nothing checked. A report day is a fact in
scripts/usda_dates.py, so the line that names it is put in by the generator,
put back after the critic, and the gate refuses to publish without it.

  apply(briefing, day, now_utc)  -> briefing with the fixed watch item first and
                                    the report named in the lead
  check(briefing, day)           -> [] or the reasons it is missing (the gate)

    python3 scripts/report_day.py --selftest
"""
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import usda_dates  # noqa: E402  (the single date table)

TIME_CT = "11:00 AM CT"
PAGE = "agsist.com/whats-priced-in"
FIXED = "report-day"


def _names(reports):
    if len(reports) == 1:
        return reports[0]
    return ", ".join(reports[:-1]) + " and " + reports[-1]


def keyword(reports):
    """The word the lead must contain: the first report's name."""
    return reports[0] if reports else ""


def watch_item(day):
    reps = usda_dates.major_reports(day)
    if not reps:
        return None
    # Under 20 words (briefing_cut.CAP_WATCH_DESC), no level, no forecast.
    return {"time": TIME_CT,
            "desc": "USDA %s. Graded against the trade survey on %s." % (_names(reps), PAGE),
            "fixed": FIXED}


def lede_sentence(day, now_utc=None):
    reps = usda_dates.major_reports(day)
    if not reps:
        return ""
    printed = False
    if now_utc is not None:
        printed = (now_utc.astimezone(timezone.utc).date() == day
                   and now_utc.astimezone(timezone.utc).hour >= 16)
    if printed:
        return "USDA's %s came out at 11:00 a.m. CT today." % _names(reps)
    # Future tense, so briefing_gate's fabricated-release check has nothing to find.
    return "USDA's %s %s out at 11:00 a.m. CT today." % (_names(reps), "comes" if len(reps) == 1 else "come")


def apply(briefing, day, now_utc=None):
    """Put the fixed line in. Idempotent: running it twice changes nothing.

    The watch list stays at three items. A model item that already names the
    report is the one dropped (it would say the same thing twice); otherwise
    the last model item goes."""
    item = watch_item(day)
    if not item:
        return briefing
    reps = usda_dates.major_reports(day)
    kw = keyword(reps).lower()
    wl = [w for w in (briefing.get("watch_list") or []) if isinstance(w, dict) and w.get("fixed") != FIXED]
    dup = [i for i, w in enumerate(wl) if kw in str(w.get("desc", "")).lower() + str(w.get("time", "")).lower()]
    if dup:
        wl.pop(dup[0])
    wl = [item] + wl
    briefing["watch_list"] = wl[:3]
    lead = str(briefing.get("lead") or "")
    if kw not in lead.lower():
        s = lede_sentence(day, now_utc)
        briefing["lead"] = (s + " " + lead).strip() if lead else s
    briefing["report_day"] = {"reports": reps, "watch": item["desc"]}
    return briefing


def check(briefing, day):
    """[] when a report day's fixed line and lead mention are in place (or it is
    not a report day); otherwise the reasons, which briefing_gate turns into a
    FAIL."""
    item = watch_item(day)
    if not item:
        return []
    out = []
    wl = briefing.get("watch_list") or []
    if not any(isinstance(w, dict) and w.get("desc") == item["desc"] for w in wl):
        out.append("report day (%s) but the watch list does not carry the fixed line %r"
                   % (", ".join(usda_dates.major_reports(day)), item["desc"]))
    kw = keyword(usda_dates.major_reports(day))
    if kw.lower() not in str(briefing.get("lead") or "").lower():
        out.append("report day but the lead never names the %s" % kw)
    return out


def _selftest():
    fails = []

    def ck(c, m):
        print(("  ok    " if c else "  FAIL  ") + m)
        if not c:
            fails.append(m)
    oct9, oct8, sep30 = date(2026, 10, 9), date(2026, 10, 8), date(2026, 9, 30)
    ck(usda_dates.major_reports(oct9) == ["WASDE", "Crop Production"], "Oct 9: WASDE and Crop Production")
    ck(usda_dates.major_reports(sep30) == ["Grain Stocks"], "Sep 30: Grain Stocks")
    ck(usda_dates.major_reports(oct8) == [], "Oct 8: nothing")
    it = watch_item(oct9)
    ck(it["desc"] == "USDA WASDE and Crop Production. Graded against the trade survey on agsist.com/whats-priced-in.",
       it["desc"])
    ck(len(it["desc"].split()) <= 20, "the fixed line fits the 20-word watch cap")

    # THE REAL OCT 9 SHAPE: three model items, none about the WASDE, and a lead
    # that never names it.
    b = {"lead": "Corn closed at $4.99 3/4, down a penny, as harvest pressure builds.",
         "watch_list": [{"time": "7:30 AM CT", "desc": "Export sales"},
                        {"time": "Close", "desc": "December corn at $5.00"},
                        {"time": "All day", "desc": "Harvest pace"}]}
    b = apply(b, oct9, datetime(2026, 10, 9, 11, 47, tzinfo=timezone.utc))
    ck(b["watch_list"][0]["desc"] == it["desc"] and len(b["watch_list"]) == 3, "fixed line first, list stays at 3")
    ck([w["desc"] for w in b["watch_list"][1:]] == ["Export sales", "December corn at $5.00"],
       "the last model item makes room")
    ck(b["lead"].startswith("USDA's WASDE and Crop Production come out at 11:00 a.m. CT today. Corn closed"), b["lead"])
    ck(lede_sentence(sep30) == "USDA's Grain Stocks comes out at 11:00 a.m. CT today.", lede_sentence(sep30))
    ck(check(b, oct9) == [], "the gate passes it")
    again = apply(dict(b, watch_list=list(b["watch_list"])), oct9)
    ck(again["watch_list"] == b["watch_list"] and again["lead"] == b["lead"], "applying twice changes nothing")

    # a model item that already names the report is the one replaced
    b2 = apply({"lead": "Ahead of the WASDE, corn held.",
                "watch_list": [{"time": "Close", "desc": "Dec corn $5"},
                               {"time": "11 CT", "desc": "The WASDE yield"},
                               {"time": "x", "desc": "y"}]}, oct9)
    ck([w["desc"] for w in b2["watch_list"]] == [it["desc"], "Dec corn $5", "y"], "the duplicate WASDE item goes")
    ck(b2["lead"] == "Ahead of the WASDE, corn held.", "a lead that already names it is left alone")

    # after the print, past tense
    ck(lede_sentence(oct9, datetime(2026, 10, 9, 17, 0, tzinfo=timezone.utc)).endswith("came out at 11:00 a.m. CT today."),
       "a post-print rerun says it came out")

    # the gate refuses a briefing without it
    bad = {"lead": "Corn closed at $4.99.", "watch_list": [{"time": "Close", "desc": "Dec corn"}]}
    msgs = check(bad, oct9)
    ck(len(msgs) == 2 and "fixed line" in msgs[0] and "WASDE" in msgs[1], "missing line and missing lead both refused")
    ck(check(bad, oct8) == [], "not a report day: nothing required")
    # a model that types the line itself without the marker still passes: the
    # check is on the words a reader sees
    typed = {"lead": "WASDE today.", "watch_list": [{"time": TIME_CT, "desc": it["desc"]}]}
    ck(check(typed, oct9) == [], "the check reads the words, not the marker")
    # THE GATE ITSELF REFUSES IT, not just this function: run the shipped gate.
    try:
        import briefing_gate
        _p, iss = briefing_gate.run(bad, None, today=oct9, archive_dir=None)
        ck(any(s == "FAIL" and c == "report-day" for s, c, _ in iss), "briefing_gate FAILs a report day without the line")
        _p, iss = briefing_gate.run(b, None, today=oct9, archive_dir=None)
        ck(not any(c == "report-day" for _s, c, _ in iss), "and does not fail one that carries it")
    except ImportError as e:
        ck(False, "briefing_gate could not be imported: %s" % e)

    # AND EVERY WRITER CALLS IT. Sliced to the function body, so a comment or
    # the def line cannot satisfy the check.
    here = Path(__file__).resolve().parent

    def body(fname, fn):
        src = (here / fname).read_text(encoding="utf-8")
        i = src.index("def %s(" % fn)
        j = src.find("\ndef ", i + 1)
        return src[i:j if j > 0 else len(src)]
    ck("report_day.apply(briefing" in body("generate_daily.py", "main"), "generate_daily.main applies the line")
    ck("report_day.apply(briefing" in body("critique_briefing.py", "apply_rewrite"),
       "the critic puts it back after a rewrite")
    ck("report_day.check(daily" in body("briefing_gate.py", "run"), "the gate checks it")

    print()
    print("report_day: " + ("all passed" if not fails else "%d FAILED" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
