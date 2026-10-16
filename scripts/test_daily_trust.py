#!/usr/bin/env python3
"""
FOUR THINGS A READER CAUGHT IN ONE SUNDAY ISSUE (2026-10-11), PINNED.

  1. Crop Progress in Columbus Day week. /usda-calendar said Tuesday Oct 13,
     the homepage strip kept Monday Oct 12, and the daily prompt told the
     model "Monday 3:00 PM CT". generate_daily now takes the day from
     usda_dates (the rule /usda-calendar and the strip follow; the strip's
     own test is test/usda-holidays.test.mjs).
  2. "Week ahead in ag / Coming up next week" sat over CRP payments that
     "went out late Thursday". The label is now decided by code
     (mark_week_ahead): a dated upcoming event the item's text names.
  3. The byline said "founder". It says Certified Crop Adviser (CCA).
  4. "Corn takes the brunt of wasde". Known acronyms are repaired in the
     headline and titles (fix_acronyms).

    python3 scripts/test_daily_trust.py

Fixtures only: no network, no model call, nothing sent.
"""
import os
import sys
from datetime import date, datetime as _real_dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_daily as g  # noqa: E402

fails = []


def check(ok, msg, got=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {msg}" + ("" if ok else f"  -- {got!r}"))
    if not ok:
        fails.append(msg)


class _Clock:
    """Set generate_daily's clock (it reads datetime.now()) for a block."""
    def __init__(self, y, m, d, hh=11, mm=47):
        fixed = _real_dt(y, m, d, hh, mm)

        class FakeDT(_real_dt):
            @classmethod
            def now(cls, tz=None):
                return fixed if tz is None else fixed.replace(tzinfo=tz)
        self.fake = FakeDT

    def __enter__(self):
        self.saved = g.datetime
        g.datetime = self.fake

    def __exit__(self, *a):
        g.datetime = self.saved


print("1. Crop Progress in a federal-holiday week\n")
line = g.weekly_release_line(date(2026, 10, 11))
check("Crop Progress: Tuesday, Oct 13 (moved from Monday, Oct 12, Columbus Day), 3:00 PM CT" in line,
      "Sunday Oct 11: the prompt names Tuesday Oct 13 for Crop Progress", line)
check("Monday" not in line.replace("moved from Monday", ""), "and no bare Monday", line)
check("Crop Progress: Monday, Oct 19" in g.weekly_release_line(date(2026, 10, 17)),
      "Saturday Oct 17: next week's is an ordinary Monday")
check("Crop Progress" not in g.weekly_release_line(date(2026, 12, 13)), "December: no Crop Progress line")
check("Columbus Day" in g.CALENDAR_FACTS_2026 and "Crop Progress moves to Tue Oct 13" in g.CALENDAR_FACTS_2026,
      "the calendar block knows Columbus Day closes USDA")

with _Clock(2026, 10, 12):
    r = g.get_usda_release_today()
check("Crop Progress" not in r, "Mon Oct 12 (Columbus Day, CME open): no Crop Progress announced", r)
with _Clock(2026, 10, 13):
    r = g.get_usda_release_today()
check("USDA Crop Progress, 3:00 PM CT (moved from Monday, Columbus Day)" in r,
      "Tue Oct 13: the release-day block carries the moved Crop Progress", r)
with _Clock(2026, 10, 19):
    r = g.get_usda_release_today()
check("USDA Crop Progress, 3:00 PM CT" in r and "moved" not in r, "Mon Oct 19: ordinary Monday", r)
with _Clock(2026, 11, 27):
    r = g.get_usda_release_today()
check("Weekly Export Sales, 7:30 AM CT (moved from Thursday, Thanksgiving)" in r,
      "Fri Nov 27: Export Sales moved from Thanksgiving", r)

b = {"watch_list": [{"time": "Monday 3:00 PM CT", "desc": "USDA Crop Progress: harvest pace vs 5-year"},
                    {"time": "Thursday 7:30 AM CT", "desc": "Export Sales"},
                    {"time": "All week", "desc": "Crop Progress Monday Oct 12 then the harvest"}]}
b, fx = g.fix_crop_progress_day(b, date(2026, 10, 11))
check(b["watch_list"][0]["time"] == "Tuesday 3:00 PM CT", "watch list 'Monday 3:00 PM CT Crop Progress' -> Tuesday",
      b["watch_list"][0])
check(b["watch_list"][1]["time"] == "Thursday 7:30 AM CT", "an item that is not Crop Progress is left alone")
check(b["watch_list"][2]["desc"] == "Crop Progress Tuesday Oct 13 then the harvest",
      "'Monday Oct 12' becomes 'Tuesday Oct 13', date and all", b["watch_list"][2])
b, fx = g.fix_crop_progress_day({"watch_list": [{"time": "Monday 3 PM CT", "desc": "Crop Progress"}]},
                                date(2026, 10, 17))
check(not fx, "an ordinary week's Monday is not touched")

print("\n2. 'Week ahead in ag' only over a dated upcoming event\n")
past = {"market_closed": True, "outside_the_pit": [{
    "title": "USDA issues $1.8 billion in CRP payments",
    "body": "The payments went out late Thursday to producers idling land under CRP.", "tag": "POLICY"}]}
g.mark_week_ahead(past, date(2026, 10, 11))
check(past["otp_week_ahead"] is False, "Sunday's CRP item (no event_date): not week ahead")
html = g.render_outside_the_pit_html(past["outside_the_pit"], past["otp_week_ahead"])
check("OUTSIDE THE PIT" in html and "WEEK AHEAD" not in html and "Coming up next week" not in html,
      "and it renders as Outside the pit", html[:200])

ahead = {"market_closed": True, "outside_the_pit": [{
    "title": "Senate ag committee marks up the farm bill Tuesday",
    "body": "Markup is set for Oct 13.", "event_date": "2026-10-13"}]}
g.mark_week_ahead(ahead, date(2026, 10, 11))
check(ahead["otp_week_ahead"] is True, "a dated upcoming event the text names: week ahead")
check("WEEK AHEAD IN AG" in g.render_outside_the_pit_html(ahead["outside_the_pit"], True), "and it renders so")

lied = {"market_closed": True, "outside_the_pit": [{
    "title": "USDA issues CRP payments", "body": "They went out late Thursday.", "event_date": "2026-10-08"}]}
notes = g.mark_week_ahead(lied, date(2026, 10, 11))
check(lied["otp_week_ahead"] is False and "event_date" not in lied["outside_the_pit"][0] and notes,
      "an event_date in the past is dropped and the label is not used", lied)

unnamed = {"market_closed": True, "outside_the_pit": [{
    "title": "Farm bill markup", "body": "The committee meets soon.", "event_date": "2026-10-14"}]}
g.mark_week_ahead(unnamed, date(2026, 10, 11))
check(unnamed["otp_week_ahead"] is False, "a future event_date the text never names: not week ahead")

far = {"market_closed": True, "outside_the_pit": [{
    "title": "Farm bill vote Nov 30", "body": "x", "event_date": "2026-11-30"}]}
g.mark_week_ahead(far, date(2026, 10, 11))
check(far["otp_week_ahead"] is False, "more than nine days out: not week ahead")

weekday = dict(ahead, market_closed=False)
g.mark_week_ahead(weekday, date(2026, 10, 12))
check(weekday["otp_week_ahead"] is False, "on a trading day the label is always Outside the pit")

prompt = g.build_system_prompt({"is_closed": True, "reason": "weekend", "day_name": "Sunday", "note": ""},
                               [], None, None, "", "", [], [], "")
check('"event_date"' in prompt and "Never invent an event or a date" in prompt
      and "Never describe something that already happened as coming up" in prompt,
      "the prompt asks for a dated upcoming event on weekends and forbids inventing one")
for f, needle in (("index.html", "data.otp_week_ahead?'WEEK AHEAD IN AG'"),
                  ("daily.html", "data.otp_week_ahead?'WEEK AHEAD IN AG'")):
    src = open(os.path.join(HERE, "..", f), encoding="utf-8").read()
    if f == "index.html":  # its page script moved to components/home.js (2026-10-12)
        src += open(os.path.join(HERE, "..", "components", "home.js"), encoding="utf-8").read()
    check(needle in src and "market_closed?'WEEK AHEAD" not in src and "marketClosed?'WEEK AHEAD" not in src,
          f"{f} reads otp_week_ahead, not market_closed")

print("\n3. The byline\n")
BY = "Sigurd Lindquist</strong>, CCA"
check(BY in g.render_byline_block_html(), "archive byline", g.render_byline_block_html())
for f in ("daily.html", "index.html"):
    src = open(os.path.join(HERE, "..", f), encoding="utf-8").read()
    check(BY in src and "Lindquist</strong>, founder" not in src, f"{f} byline")
src = open(os.path.join(HERE, "send_morning_brief.py"), encoding="utf-8").read()
check("Written by Sigurd Lindquist, CCA." in src and "Lindquist, founder" not in src,
      "send_morning_brief.py byline (source text only; not run)")
check("insurance" not in g.render_byline_block_html().lower(), "the byline never calls him a crop insurance agent")

print("\n4. Lowercase acronyms in headlines and titles\n")
for raw, want in (
    ("Corn takes the brunt of wasde", "Corn takes the brunt of WASDE"),
    ("Beans firm after usda and cftc data", "Beans firm after USDA and CFTC data"),
    ("Nass trims yield; fsa offices stay open", "NASS trims yield; FSA offices stay open"),
    ("Eia shows ethanol up, epa rfs talk returns", "EIA shows ethanol up, EPA RFS talk returns"),
    ("arc/plc signup opens Nov 2", "ARC/PLC signup opens Nov 2"),
    ("Funds add shorts in the cot report", "Funds add shorts in the COT report"),
    ("The arc of the harvest", "The arc of the harvest"),
    ("A cot in the machine shed", "A cot in the machine shed"),
    ("Buyers tell us basis is firm", "Buyers tell us basis is firm"),
    ("u.s. exports rise", "U.S. exports rise"),
    ("See usda.gov for the report", "See usda.gov for the report"),
    ("Wasde's corn yield comes in low", "WASDE's corn yield comes in low"),
):
    out = g.fix_headline_case({"headline": raw, "lead": "x"})["headline"]
    check(out == want, f"{raw!r} -> {want!r}", out)
b = g.fix_headline_case({"headline": "x", "lead": "x",
                         "sections": [{"title": "Corn after the wasde", "body": "- x"}],
                         "outside_the_pit": [{"title": "Noaa winter outlook", "body": "x"}]})
check(b["sections"][0]["title"] == "Corn after the WASDE", "section title", b["sections"][0]["title"])
check(b["outside_the_pit"][0]["title"] == "NOAA winter outlook", "outside the pit title", b["outside_the_pit"][0]["title"])
check(g.daily_page_title({"headline": "Corn takes the brunt of wasde"}, "2026-10-11").startswith(
    "Corn takes the brunt of WASDE"), "the page title too")

print("\n5. The 2026-10-12 cents and the USDA direction\n")
# Shipped: corn "up a quarter cent" (board +1.25c), beans "slipped seven
# cents" (board -9.25c), and "Friday's yield cut" after USDA raised corn to
# 181.2 from 178.5. The model was shown the move as "+0.0125" dollars.
import json as _json
import briefing_gate as _bg  # noqa: E402
ROOT = os.path.dirname(HERE)
for rel in ("data/daily.json", "data/daily-archive/2026-10-12.json", "daily/2026-10-12.html"):
    t = open(os.path.join(ROOT, rel), encoding="utf-8").read()
    if not ('"date": "Monday, October 12, 2026"' in t or "2026-10-12" in rel):
        continue
    check("a quarter cent" not in t and "seven cents" not in t and "yield cut" not in t,
          f"{rel}: the wrong figures are gone")
    check("up 1\u00bc\u00a2" in t and "9\u00bc\u00a2" in t and "USDA raised the corn yield" in t,
          f"{rel}: up 1\u00bc\u00a2, 9\u00bc\u00a2 and the yield raise are printed")
_d = _json.load(open(os.path.join(ROOT, "data/daily-archive/2026-10-12.json"), encoding="utf-8"))
_iss = []
_bg.check_number_binding(_d, lambda c, m: _iss.append(("FAIL", c, m)), lambda c, m: _iss.append(("WARN", c, m)),
                         archive_dir=os.path.join(ROOT, "data/daily-archive"))
_bg.check_usda_revisions(_d, lambda c, m: _iss.append(("FAIL", c, m)), lambda c, m: _iss.append(("WARN", c, m)),
                         est_path=os.path.join(ROOT, "data/analyst-estimates.json"))
_bad = [m for s, c, m in _iss if c in ("bind:cents", "usda-revision")]
check(not _bad, "the corrected issue passes the cents and USDA-direction checks", _bad)
_src = open(os.path.join(HERE, "generate_daily.py"), encoding="utf-8").read()
check("net / 100:+.4f" not in _src and "pricefmt.move(net, sign=True)" in _src,
      "the model's price block states grain moves in cents (pricefmt), not dollars")

print(f"\n{len(fails)} failure(s)")
sys.exit(1 if fails else 0)
