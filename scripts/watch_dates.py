#!/usr/bin/env python3
"""
watch_dates.py -- every weekday in the Daily's watch list carries its date,
written by code, never left to the model.

WHY. The Friday Oct 16 2026 issue's watch list said "Thursday 7:30 a.m. CT:
Export sales report". In a Friday issue that Thursday is six days out (Oct 22),
and a reader opening the email on Monday cannot tell which Thursday is meant.
The model writes the weekday; this puts the date beside it ("Thursday, Oct 22,
7:30 a.m. CT"), in the generator and again after the critic's rewrite.

Which day a weekday means: the next one after the issue's day. The issue's own
weekday is today when the issue is written in the morning (before noon CT), and
a week out when it is written in the afternoon or evening (a Friday 5 p.m. issue
saying "Friday" means next Friday; that day's own Friday events are over).

  apply(briefing, now_ct)  -> (briefing, fixes) with the dates in place
  date_for(weekday, now_ct) -> the date a weekday name means

    python3 scripts/watch_dates.py --selftest
"""
import re
import sys
from datetime import datetime, timedelta

DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
WD = re.compile(r"\b(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b(\.)?('s)?")     # capitalized only: "more sun" is not Sunday
MON = r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b"
DATED = re.compile(MON, re.I)
SLASH = re.compile(r"\b\d{1,2}/\d{1,2}\b")


def _idx(tok):
    t = tok.lower()[:3]
    return [d[:3] for d in DAYS].index(t)


def date_for(tok, now_ct):
    """The date a weekday name means in an issue written at now_ct (a CT datetime)."""
    want, today = _idx(tok), now_ct.date()
    ahead = (want - today.weekday()) % 7
    if ahead == 0 and now_ct.hour >= 12:
        ahead = 7
    return today + timedelta(days=ahead)


def _md(d):
    return d.strftime("%b ") + str(d.day)


def date_text(text, now_ct, style="time"):
    """text with its first undated weekday dated. style 'time': "Thursday, Oct 22";
    style 'desc': "Thursday (Oct 22)" (reads inside a sentence, and after a possessive)."""
    if not isinstance(text, str) or DATED.search(text) or SLASH.search(text):
        return text, None
    m = WD.search(text)
    if not m:
        return text, None
    d = date_for(m.group(1), now_ct)
    word = m.group(0)
    if style == "time":
        rest = text[m.end():]
        sep = "" if (not rest or rest[:1] in ",:;)") else ","
        new = word + ", " + _md(d) + sep
    else:
        new = word + " (" + _md(d) + ")"
    return text[:m.start()] + new + text[m.end():], "%s -> %s" % (word, _md(d))


def apply(briefing, now_ct=None):
    """Date the weekday in each watch item: in its time line, or in its text when
    the time line names no day. Items already carrying a date are left alone."""
    if now_ct is None:
        now_ct = _now_ct()
    fixes = []
    for item in briefing.get("watch_list") or []:
        if not isinstance(item, dict):
            continue
        t = item.get("time")
        if isinstance(t, str) and WD.search(t):
            item["time"], f = date_text(t, now_ct, "time")
            if f:
                fixes.append("time: " + f)
            continue
        if isinstance(t, str) and (DATED.search(t) or SLASH.search(t)):
            continue
        dsc = item.get("desc")
        if isinstance(dsc, str):
            item["desc"], f = date_text(dsc, now_ct, "desc")
            if f:
                fixes.append("desc: " + f)
    return briefing, fixes


def _now_ct():
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/Chicago"))
    except Exception:  # noqa: BLE001
        return datetime.utcnow() - timedelta(hours=5)


def selftest():
    bad = 0

    def ck(name, ok):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    fri_eve = datetime(2026, 10, 16, 17, 27)      # the Oct 16 issue, compiled 5:27 p.m. CT
    fri_morn = datetime(2026, 10, 16, 6, 30)
    sat = datetime(2026, 10, 17, 6, 0)
    b = {"watch_list": [
        {"time": "Thursday 7:30 a.m. CT", "desc": "Export sales report. Another round of China bean bookings would say demand is real."},
        {"time": "Ongoing", "desc": "Corn back under $4.70 would confirm harvest supply is still setting the tone."},
        {"time": "Ongoing", "desc": "Watch Monday's Crop Progress for harvest pace."},
    ]}
    out, fx = apply(b, fri_eve)
    ck("the Oct 16 export sales line: Thursday, Oct 22", out["watch_list"][0]["time"] == "Thursday, Oct 22, 7:30 a.m. CT")
    ck("a line with no weekday is left alone", out["watch_list"][1]["desc"].startswith("Corn back under $4.70"))
    ck("a weekday in the text is dated in place, possessive kept", out["watch_list"][2]["desc"] == "Watch Monday's (Oct 19) Crop Progress for harvest pace.")
    ck("fixes are logged", len(fx) == 2)
    out2, fx2 = apply(out, fri_eve)
    ck("running twice changes nothing", out2 == out and not fx2)
    ck("already dated is left alone", date_text("Thursday, Oct 22, 7:30 a.m. CT", fri_eve)[1] is None
       and date_text("Thu Oct 22 7:30", fri_eve)[1] is None and date_text("Thursday 10/22", fri_eve)[1] is None)
    ck("the issue's own weekday: today in the morning, next week in the evening",
       date_for("Friday", fri_morn).isoformat() == "2026-10-16" and date_for("Friday", fri_eve).isoformat() == "2026-10-23")
    ck("a Saturday issue: Monday is Oct 19, Thursday Oct 22", date_for("Mon", sat).day == 19 and date_for("Thursday", sat).day == 22)
    ck("short weekday and a colon after it", date_text("Thu: Export sales", fri_eve)[0] == "Thu, Oct 22: Export sales")
    ck("time line that is only the weekday", date_text("Tuesday", fri_eve)[0] == "Tuesday, Oct 20")
    ck("a word that only starts like a day is not one", date_text("Sunflower prices", fri_eve)[1] is None
       and date_text("Monitor the basis", fri_eve)[1] is None and date_text("Dry, more sun this week", fri_eve)[1] is None)
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
