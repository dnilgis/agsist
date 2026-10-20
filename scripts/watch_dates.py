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

A WEEKDAY THAT POINTS BACK (2026-10-20). The Oct 18 watch list said "Cash
cattle firm above Friday's (Oct 23) $227.55 close": $227.55 was the Oct 16
settle, and this file had dated "Friday's" as the next Friday. Now the data's
own dates come first: when the line quotes a price that is a settle on file
(data/prices.json, each quote's settles by date) on exactly one date, the
weekday gets that date, and the weekday word is corrected if it names another
day. Without a match, "since Friday" and "last Friday" get the most recent
Friday; "Friday's close" with no settle on file to tie it to could be either
Friday, so it is left undated rather than dated wrong.

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


BACK = re.compile(r"^'s\b[^.;]{0,40}?\b(close|closes|closed|settle|settled|settlement|finish|high|low)\b", re.I)
BACK_BEFORE = re.compile(r"\b(since|last)\s+$", re.I)
PRICE = re.compile(r"\$\s?(\d{1,6}(?:,\d{3})*(?:\.\d{1,4})?)")


def load_settles(path=None):
    """[(dollars, date)] for every settle data/prices.json carries. Grain
    quotes are in cents, so each value is offered as is and over 100."""
    import json
    import os
    path = path or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "prices.json")
    try:
        with open(path, encoding="utf-8") as f:
            quotes = (json.load(f) or {}).get("quotes") or {}
    except Exception:  # noqa: BLE001
        return []
    out = []
    for q in quotes.values():
        for d, v in ((q or {}).get("settles") or {}).items():
            if isinstance(v, (int, float)):
                out.append((float(v), d))
                out.append((float(v) / 100.0, d))
    return out


def data_date(text, settles, now_ct):
    """The one date (on or before the issue day) on which a price quoted in
    text is a settle on file, else None."""
    if not settles:
        return None
    today = now_ct.date().isoformat()
    hits = set()
    for m in PRICE.finditer(text):
        try:
            x = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        dec = len(m.group(1).split(".")[1]) if "." in m.group(1) else 0
        if dec < 2:
            continue                       # "$5" is a level, not a quoted settle
        tol = 0.5 * 10 ** (-dec) + 1e-6
        for v, d in settles:
            if abs(v - x) <= tol and d <= today:
                hits.add(d)
    if len(hits) != 1:
        return None
    return datetime.strptime(hits.pop(), "%Y-%m-%d").date()


def date_back(tok, now_ct):
    """The most recent date (today included) a weekday name can mean."""
    want, today = _idx(tok), now_ct.date()
    return today - timedelta(days=(today.weekday() - want) % 7)


def _md(d):
    return d.strftime("%b ") + str(d.day)


def date_text(text, now_ct, style="time", settles=None):
    """text with its first undated weekday dated. style 'time': "Thursday, Oct 22";
    style 'desc': "Thursday (Oct 22)" (reads inside a sentence, and after a possessive)."""
    if not isinstance(text, str) or DATED.search(text) or SLASH.search(text):
        return text, None
    m = WD.search(text)
    if not m:
        return text, None
    word = m.group(0)
    d = data_date(text, settles, now_ct)
    if d is not None:
        if _idx(m.group(1)) != d.weekday():      # the data's own day wins over the model's word
            name = DAYS[d.weekday()].capitalize()
            if len(m.group(1)) <= 4:
                name = name[:3]
            word = name + (m.group(2) or "") + (m.group(3) or "")
    elif BACK_BEFORE.search(text[:m.start()]):
        d = date_back(m.group(1), now_ct)
    elif BACK.match(text[m.end(1):]):
        return text, None                  # "Friday's close": which Friday is not ours to guess
    else:
        d = date_for(m.group(1), now_ct)
    if style == "time":
        rest = text[m.end():]
        sep = "" if (not rest or rest[:1] in ",:;)") else ","
        new = word + ", " + _md(d) + sep
    else:
        new = word + " (" + _md(d) + ")"
    return text[:m.start()] + new + text[m.end():], "%s -> %s" % (m.group(0), word + " " + _md(d) if word != m.group(0) else _md(d))


def apply(briefing, now_ct=None, settles=None):
    """Date the weekday in each watch item: in its time line, or in its text when
    the time line names no day. Items already carrying a date are left alone.
    settles: [(dollars, date)], default data/prices.json (load_settles)."""
    if now_ct is None:
        now_ct = _now_ct()
    if settles is None:
        settles = load_settles()
    fixes = []
    for item in briefing.get("watch_list") or []:
        if not isinstance(item, dict):
            continue
        t = item.get("time")
        if isinstance(t, str) and WD.search(t):
            item["time"], f = date_text(t, now_ct, "time", settles)
            if f:
                fixes.append("time: " + f)
            continue
        if isinstance(t, str) and (DATED.search(t) or SLASH.search(t)):
            continue
        dsc = item.get("desc")
        if isinstance(dsc, str):
            item["desc"], f = date_text(dsc, now_ct, "desc", settles)
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
    out, fx = apply(b, fri_eve, [])
    ck("the Oct 16 export sales line: Thursday, Oct 22", out["watch_list"][0]["time"] == "Thursday, Oct 22, 7:30 a.m. CT")
    ck("a line with no weekday is left alone", out["watch_list"][1]["desc"].startswith("Corn back under $4.70"))
    ck("a weekday in the text is dated in place, possessive kept", out["watch_list"][2]["desc"] == "Watch Monday's (Oct 19) Crop Progress for harvest pace.")
    ck("fixes are logged", len(fx) == 2)
    out2, fx2 = apply(out, fri_eve, [])
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
    # 2026-10-18 issue (Sunday): "$227.55" is the Oct 16 live cattle settle
    sun = datetime(2026, 10, 18, 10, 0)
    cattle = [(223.9, "2026-10-14"), (225.95, "2026-10-15"), (227.5500030517578, "2026-10-16")]
    oct18 = "Cash cattle firm above Friday's $227.55 close supports the rally; steady or lower fades it."
    ck("Oct 18: the price's settle date, not next Friday",
       date_text(oct18, sun, "desc", cattle)[0] == "Cash cattle firm above Friday's (Oct 16) $227.55 close supports the rally; steady or lower fades it.")
    ck("a wrong weekday beside a settle on file is corrected to the data's day",
       date_text("Above Thursday's $227.55 close.", sun, "desc", cattle)[0] == "Above Friday's (Oct 16) $227.55 close.")
    ck("'Friday's close' with no settle on file: left undated, never guessed",
       date_text("Cash cattle firm above Friday's close.", sun, "desc", [])[1] is None)
    ck("'since Friday' points back", date_text("Lower since Friday on harvest pressure.", sun, "desc", [])[0]
       == "Lower since Friday (Oct 16) on harvest pressure.")
    ck("a forward weekday with no price stays forward", date_text("Friday's Cattle on Feed report", sun, "desc", [])[0]
       == "Friday's (Oct 23) Cattle on Feed report")
    ck("a level with no cents is not a settle match", data_date("Corn under $5 by Friday", [(5.0, "2026-10-16")], sun) is None)
    ck("a price on two dates is not a match",
       data_date("$4.80 Friday", [(4.80, "2026-10-15"), (4.80, "2026-10-16")], sun) is None)
    ck("a settle after the issue day is never used",
       data_date("$4.80 Friday", [(4.80, "2026-10-19")], sun) is None)
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
