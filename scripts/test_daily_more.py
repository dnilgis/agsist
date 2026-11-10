#!/usr/bin/env python3
"""
test_daily_more.py -- the farm calendar, harvest pace and fund position blocks
handed to the Daily's writer (scripts/daily_more.py), and the state basis line
second in the email's Today list (scripts/daily_v2.py promote_wow; it replaced the
North Dakota line, Nov 9 2026). Run by
test/daily-more.test.mjs. No network, no model, nothing is sent.

The files are the real ones as of Monday Nov 2 2026, trimmed to what the blocks
read (test/fixtures/daily-more/: cot.json, cot-history.json, crop-progress.json,
usda-calendar.ics), so a weekly data commit cannot move the numbers under the
test. Cases:
  Mon Nov 2, 6 a.m. CT   calendar (Export Inspections, Crop Progress, WASDE Nov 10,
                         the 2027 ARC/PLC signup opening, the Dec 11 deadline),
                         funds WITHHELD (Saturday only since Nov 9), harvest WITHHELD (Nov 1 week not out until 3 p.m.)
  Mon Nov 2, 4 p.m. CT   harvest on (the report is out)
  Tue Nov 3              harvest on, funds withheld
  Sat Oct 31             funds on (every fund check), harvest withheld, no empty weekend day lines
  Mon Nov 9              no funds (Monday); Sat Nov 7 funds stale
  Mon Jan 11 2027        out of season: nothing but the calendar
  out-of-season file, 5-year average present, missing files, holiday weeks
  the prompt: each block carries its source, its rule and no em dash; the
  generator puts it in the message the fact check reads (save_briefing_inputs)
  the email: the basis line rides second in Today, tagged, and leaves Only here

    python3 scripts/test_daily_more.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import copy
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_more as M  # noqa: E402

FIX = os.path.join(REPO, "test", "fixtures", "daily-more")
FAILS = []


def ok(c, m):
    if not c:
        FAILS.append(m)
        print("FAIL", m)


def utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def run(day, now, repo=FIX):
    return M.build(date.fromisoformat(day), utc(now), repo)


def joined(b):
    return "\n".join(b.get("lines") or [])


def fixture_copy(edit=None):
    d = tempfile.mkdtemp()
    shutil.copytree(FIX, d, dirs_exist_ok=True)
    if edit:
        edit(d)
    return d


def main():
    cot = json.load(open(os.path.join(FIX, "data", "cot.json")))

    # ── Monday Nov 2, 6 a.m. CT: the morning DTN had the ARC/PLC opening and we did not
    b = run("2026-11-02", "2026-11-02T12:00:00Z")
    cal = joined(b["calendar"])
    ok("Today (Monday, Nov 2): USDA Export Inspections, 10:00 AM CT; USDA Crop Progress, 3:00 PM CT." in cal, "Nov 2: today's reports: " + cal)
    ok("Next WASDE: Tuesday, Nov 10, 11:00 AM CT, 8 days away." in cal, "Nov 2: WASDE countdown")
    ok("the 2027 ARC/PLC signup opens today at county FSA offices and runs to Monday, Mar 15, 2027." in cal, "Nov 2: ARC/PLC opening")
    ok("2026 ARC/PLC signup deadline is Friday, Dec 11, 39 days away." in cal, "Nov 2: Dec 11 deadline countdown")
    ok("webinar" not in cal, "Nov 2: the Nov 17 webinar is not today's news")
    ok("withheld" in b["harvest"] and "not yet released" in b["harvest"]["withheld"],
       "Nov 2 morning: the week ending Nov 1 is not out until 3 p.m. CT, withheld: %r" % b["harvest"])
    # Nov 9 2026: funds run on Saturday only, once per release (was Saturday and Monday)
    ok(not b["funds"].get("lines") and "Saturday" in b["funds"].get("withheld", ""),
       "Nov 2: Monday carries no fund block (Saturday only since Nov 9): %r" % b["funds"])
    f = run("2026-10-31", "2026-10-31T12:00:00Z")["funds"]
    ok(len(f.get("lines") or []) == 4, "Oct 31: four fund lines (corn, soybeans, Chicago wheat, live cattle): %r" % f)
    for key, noun in (("corn", "corn"), ("beans", "soybean"), ("wheat", "Chicago wheat"), ("livecattle", "live cattle")):
        net, prev = cot[key]["net"], cot[key]["prev"]
        want = "net %s %s %s contracts, %s %s than the week before" % (
            "long" if net > 0 else "short", format(abs(net), ","), noun, format(abs(net - prev), ","),
            "more" if abs(net) > abs(prev) else "fewer")
        ok(want in joined(f), "Oct 31: %s fund line from data/cot.json: %s" % (key, want))
    ok("22,601 more" in joined(f), "Oct 31: Chicago wheat net short grew 22,601 (the audit's number)")
    ok("positions as of Tuesday, Oct 27, released Friday, Oct 30, 3:30 PM ET" in f["source"], "Oct 31: funds dated: " + f["source"])
    ok("futures only" in f["source"] and "managed money" in f["source"], "Oct 31: futures-only managed money")

    # ── after 3 p.m. CT Monday (a late rerun): the report is out
    h = run("2026-11-02", "2026-11-02T21:30:00Z")["harvest"]
    ok("Corn 74% harvested in the week ending Sunday, Nov 1, up 14 points from 60% the week before." in joined(h), "Nov 2 late: corn pace: %r" % h)
    ok("Soybeans 88% harvested in the week ending Sunday, Nov 1, up 9 points from 79% the week before." in joined(h), "Nov 2 late: bean pace")
    ok("5-year" not in joined(h) and "last year" not in joined(h), "no 5-year average or last year when the file has none")
    ok(h.get("source") == "USDA NASS Crop Progress, released Monday, Nov 2, 3:00 PM CT.", "harvest source dated: %r" % h.get("source"))
    ok(not run("2026-11-02", "2026-11-02T20:59:00Z")["harvest"].get("lines"), "one minute before 3 p.m. CT: withheld")

    # ── Tuesday Nov 3
    b = run("2026-11-03", "2026-11-03T12:00:00Z")
    ok("Corn 74%" in joined(b["harvest"]), "Nov 3: harvest pace on Tuesday")
    ok(not b["funds"].get("lines"), "Nov 3: no fund block on a Tuesday")
    ok("the 2027 ARC/PLC signup opened Monday, Nov 2 at county FSA offices" in joined(b["calendar"]), "Nov 3: opened yesterday")

    # ── Saturday Oct 31
    b = run("2026-10-31", "2026-10-31T12:00:00Z")
    ok(len(b["funds"].get("lines") or []) == 4, "Oct 31: fund block on Saturday")
    ok("harvest pace runs on Monday and Tuesday" in b["harvest"].get("withheld", ""), "Oct 31: no harvest block on Saturday")
    ok(not re.search(r"^(Today|Tomorrow) \((Saturday|Sunday)", joined(b["calendar"]), re.M), "Oct 31: no empty weekend day lines")
    b = run("2026-11-01", "2026-11-01T12:00:00Z")
    ok("Tomorrow (Monday, Nov 2): USDA Export Inspections, 10:00 AM CT; USDA Crop Progress, 3:00 PM CT." in joined(b["calendar"]), "Nov 1: Sunday names Monday's reports")
    ok("opens tomorrow" in joined(b["calendar"]), "Nov 1: the signup opens tomorrow")
    ok(not b["funds"].get("lines"), "Nov 1: Sunday carries no fund block (Saturday only)")
    ok(not run("2026-10-30", "2026-10-30T19:00:00Z")["funds"].get("lines"), "Fri Oct 30 before 3:30 PM ET: no fund block")

    # ── a week later: stale
    b = run("2026-11-09", "2026-11-09T12:00:00Z")
    ok(not b["funds"].get("lines"), "Nov 9: no fund block on a Monday: %r" % b["funds"])
    ok("not this weekend's" in run("2026-11-07", "2026-11-07T12:00:00Z")["funds"].get("withheld", ""),
       "Sat Nov 7 with the Oct 27 report still on file: last week's COT is withheld")
    ok("week ending Sunday, Nov 1" in joined(b["harvest"]), "Nov 9 morning: the Nov 1 week is still the newest public report")
    ok(not run("2026-11-10", "2026-11-10T12:00:00Z")["harvest"].get("lines"),
       "Tue Nov 10: the Nov 8 week came out Monday and is not on file, so Nov 1 is stale: withheld")
    ok("Corn 74%" in joined(run("2026-11-09", "2026-11-09T12:00:00Z")["harvest"]), "Mon Nov 9: shown")

    # ── out of season (a January Monday) and an out-of-season file
    b = run("2027-01-11", "2027-01-11T12:00:00Z")
    ok(not b["harvest"].get("lines") and not b["funds"].get("lines"), "Jan 11 2027: no harvest, no funds")
    ok("Crop Progress" not in joined(b["calendar"]), "Jan 11 2027: no Crop Progress out of season")
    off = fixture_copy(lambda d: _edit(d, "crop-progress.json", lambda x: x.update(in_season=False)))
    ok("out of season" in run("2026-11-03", "2026-11-03T12:00:00Z", off)["harvest"].get("withheld", ""), "in_season false: withheld")

    # ── a 5-year average and last year, when the file has them
    def five(x):
        x["progress"]["corn_harvested"].update(avg5=71, prev_year=80)
    avg = fixture_copy(lambda d: _edit(d, "crop-progress.json", five))
    hc = joined(run("2026-11-03", "2026-11-03T12:00:00Z", avg)["harvest"])
    ok("; 5-year average 71%; last year 80%." in hc, "5-year average and last year printed only when present: " + hc)
    ok("Soybeans 88% harvested in the week ending Sunday, Nov 1, up 9 points from 79% the week before." in hc, "beans still without")

    # ── missing files: nothing is filled in
    empty = tempfile.mkdtemp()
    b = M.build(date(2026, 11, 2), utc("2026-11-02T21:30:00Z"), empty)
    ok(all(not v.get("lines") and v.get("withheld") for v in b.values()), "missing files: every block withheld: %r" % b)
    ok(M.prompt_block(b) == "", "missing files: nothing for the writer")
    bad = fixture_copy(lambda d: _edit(d, "cot-history.json", lambda x: [v.pop() for v in x["history"].values()]))
    ok("do not agree" in run("2026-10-31", "2026-10-31T12:00:00Z", bad)["funds"].get("withheld", ""), "COT files that disagree: withheld")

    # ── how the net changed (Nov 7): the line data/cot-analysis.json carries (card.how), printed as it stands
    # pin-ok: fixture. Corn, week to Oct 27, 2026: longs 297,797 -> 249,351, shorts 133,374 -> 168,238.
    HOW = "Longs -48,446, shorts +34,864: mostly selling longs they held."

    def with_ana(d, how=None, mm_long=249351, date_="2026-10-27"):
        ana = {"report_date": date_, "commodities": {"corn": {
            "date": date_, "net": 81113, "mm_long": mm_long, "mm_short": 168238,
            "card": {"how": how or {"long_change": -48446, "short_change": 34864,
                                    "label": "mostly selling longs they held", "line": HOW}}}}}
        json.dump(ana, open(os.path.join(d, "data", "cot-analysis.json"), "w"))
    fl = run("2026-10-31", "2026-10-31T12:00:00Z", fixture_copy(with_ana))["funds"].get("lines") or []
    corn = [x for x in fl if x.startswith("Corn:")]
    ok(len(fl) == 4 and len(corn) == 1 and corn[0].endswith(" " + HOW), "the corn fund line carries the how line: %r" % fl)
    ok(sum(HOW in x for x in fl) == 1 and not any("Longs " in x for x in fl if not x.startswith("Corn:")),
       "a market without the analysis field gets no how line: %r" % fl)
    ok(HOW in M.prompt_block(run("2026-10-31", "2026-10-31T12:00:00Z", fixture_copy(with_ana))), "the writer's block carries it")
    for why, edit in (("disagree", lambda d: with_ana(d, mm_long=249352)),
                      ("another week", lambda d: with_ana(d, date_="2026-10-20")),
                      ("withheld upstream", lambda d: with_ana(d, how={"withheld": "a week without both long and short counts"})),
                      ("no long count", lambda d: (with_ana(d), _edit(d, "cot-history.json", lambda x: x["history"]["corn"][-2].pop("long"))))):
        fl = run("2026-10-31", "2026-10-31T12:00:00Z", fixture_copy(edit))["funds"].get("lines") or []
        ok(len(fl) == 4 and not any("Longs " in x for x in fl), "how line withheld (%s): %r" % (why, fl))

    # ── holiday weeks: Columbus Day Monday, Veterans Day Wednesday
    cal = joined(run("2026-10-12", "2026-10-12T12:00:00Z")["calendar"])
    ok("Today (Monday, Oct 12): no USDA report on the calendar." in cal, "Columbus Day: nothing Monday: " + cal)
    ok("Tomorrow (Tuesday, Oct 13): USDA Export Inspections, 10:00 AM CT; USDA Crop Progress, 3:00 PM CT (moved from Monday, Columbus Day)." in cal,
       "Columbus Day: both move to Tuesday: " + cal)
    cal = joined(run("2026-11-11", "2026-11-11T12:00:00Z")["calendar"])
    ok("Tomorrow (Thursday, Nov 12): USDA Weekly Export Sales, 7:30 AM CT (a holiday week: FAS often releases a day late, so say Thursday or Friday)." in cal,
       "Veterans Day week: Export Sales hedged: " + cal)
    ok(M.crop_progress_release(date(2026, 10, 11)).date() == date(2026, 10, 13), "Crop Progress for week ending Oct 11 came out Tue Oct 13")

    # ── one rule for Export Inspections: the homepage strip's
    hj = open(os.path.join(REPO, "components", "home.js"), encoding="utf-8").read()
    m = re.search(r"\{name:'Export Inspections',wd:(\d),h:(\d+),mi:(\d+)\}", hj)
    ok(m and int(m.group(1)) - 1 == M.INSPECTIONS_WEEKDAY and (int(m.group(2)), int(m.group(3))) == M.INSPECTIONS_ET,
       "Export Inspections day and time match components/home.js")

    # ── the writer's block
    # harvest runs Monday and Tuesday, funds Saturday (Nov 9 2026): the block is checked with all three on
    b = run("2026-11-02", "2026-11-02T21:30:00Z")
    b["funds"] = run("2026-10-31", "2026-10-31T12:00:00Z")["funds"]
    pb = M.prompt_block(b)
    for t in ("FARM CALENDAR (source:", "HARVEST PACE", "FUND POSITIONS (CFTC) (source: CFTC", "RULE: Use it in a section body"):
        ok(t in pb, "prompt block has %r" % t)
    ok(pb.count("RULE:") == 3 and pb.count("(source:") == 3, "each block carries its source and its rule")
    ok("\u2014" not in pb and "\u2013" not in pb, "no em or en dash in the block")
    ok(not re.search(r"[\U0001F300-\U0001FAFF]", pb), "no emoji in the block")

    # ── the generator hands it to the writer, in the message the fact check reads
    binding_check(b)

    # ── the email: the state basis line second in Today
    email_checks()

    print("test_daily_more: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


def _edit(d, name, fn):
    p = os.path.join(d, "data", name)
    x = json.load(open(p))
    fn(x)
    json.dump(x, open(p, "w"))


def binding_check(blocks):
    """call_claude() with the day's block in the seasonal context: the saved
    inputs (what fact_check_briefing.py reads as the writer's message) carry
    every line, and so every number, of it. The API call is stubbed to fail."""
    src = open(os.path.join(HERE, "generate_daily.py"), encoding="utf-8").read()
    i, j = src.find("import daily_more as _dm"), src.find("briefing = call_claude(price_data")
    ok(0 < i < j, "generate_daily builds the block before the first call_claude")
    ok('seasonal_ctx = seasonal_ctx + "\\n\\n" + _mb' in src[i:j], "and appends it to the seasonal context every call carries")
    import generate_daily as g

    class Boom(Exception):
        pass

    class Resp:
        status_code = 401

    class FakeRequests:
        class exceptions:
            HTTPError = Boom

        @staticmethod
        def post(*a, **k):
            e = Boom("stub: no network in tests")
            e.response = Resp()
            raise e
    inp = os.path.join(tempfile.mkdtemp(), "inputs.json")
    os.environ["BRIEFING_INPUTS_PATH"] = inp
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-not-a-key")
    old = g.requests
    g.requests = FakeRequests
    try:
        ms = {"is_closed": False, "reason": "open", "day_name": "Monday", "note": ""}
        g.call_claude({"price_block": "Corn Dec $4.50", "fetched": ""}, [], "news", "Post-harvest.\n\n" + M.prompt_block(blocks),
                      {"text": "q", "attribution": "a"}, "", [], ms)
    except Boom:
        pass
    except SystemExit:
        ok(False, "call_claude exited before saving its inputs")
    finally:
        g.requests = old
        os.environ.pop("BRIEFING_INPUTS_PATH", None)
    try:
        um = json.load(open(inp))["user_message"]
    except (OSError, ValueError, KeyError):
        um = ""
    for name in ("calendar", "harvest", "funds"):
        for ln in blocks[name].get("lines") or []:
            ok(ln in um, "fact check source carries the %s line: %s" % (name, ln))


def email_checks():
    """Nov 9 2026: the state week-over-week basis line takes the Today slot the North Dakota
    basis line held (Nov 2, #258); on a quiet week nothing takes it."""
    import daily_v2 as V
    items = [{"text": "News with 5 numbers", "kind": "news", "field": "outside_the_pit[0]"},
             {"text": "Board: corn $4.50 (+1¢).", "kind": "market", "field": "locked_changes"}]
    rows = [{"st": "OH", "name": "Ohio", "crop": "corn", "wow": 10.0, "n": 50, "moved": 43, "companies": 18}]
    issue = {"basis_wow": {"print": True, "rows": rows}}
    line = V.wow_item(issue)
    ok(line and line["text"] == "Basis firmed this week: Ohio corn +10\u00a2 (43 of 50 bids moved)." and line.get("only_here")
       and line["url"] == "https://agsist.com/basis", "the state basis line, tagged, full link: %r" % line)
    it = V.promote_wow(list(items), line, V.TODAY_WITH_STORIES)
    ok(it[1] is line, "the state basis line is second in Today")
    six = [dict(items[0], text="Line %d with a number" % k) for k in range(6)]
    it6 = V.promote_wow(six, line, V.TODAY_MAX)
    ok(len(it6) == V.TODAY_MAX and it6[1] is line, "never more than TODAY_MAX lines")
    ok(V.promote_wow(list(items), None, V.TODAY_MAX) == items, "a quiet week: nothing takes the slot")
    ok(V.wow_item({"basis_wow": {"print": False, "rows": rows}}) is None, "rows the memory held back do not print")
    ok(V.promote_wow(list(items), dict(line, text="1,749 of 1,810 elevators cut bids"), V.TODAY_MAX) == items,
       "a raw elevator count never reaches Today")
    # a whole issue: the real Nov 2 issue with the line on it, and no North Dakota line anywhere
    daily = dict(json.load(open(os.path.join(REPO, "data", "daily-archive", "2026-11-02.json"), encoding="utf-8")), **issue)
    rain = {"text": "Your rain: 30.1 in. this year, 104% of normal.", "kind": "rain_vs_normal", "url": "/rain/x", "link": "Rain"}
    old = V.only_here
    V.only_here = lambda d, r=None, l=None: [dict(rain)]
    try:
        b = V.build(daily, "https://agsist.com/daily/2026-11-02.html", forward_url="https://agsist.com/?ref=email-forward",
                    fact={"id": "x", "kind": "pool", "text": "2 kernels a square foot is a bushel an acre.", "source": "ISU",
                          "url": "https://crops.extension.iastate.edu/x", "file": None}, memory=[])
    finally:
        V.only_here = old
    ok(b["items"][1].get("kind") == "basis_wow", "Nov 2 issue: the state basis line is the second Today line")
    ok(b["slots"]["only_here"] == 1, "Nov 2 issue: Only here keeps the rain line: %r" % b["slots"])
    ok(">Only here</span>&nbsp; Basis firmed this week: Ohio corn" in b["html"], "Nov 2 issue: tagged in the HTML")
    ok("- Only here: Basis firmed this week: Ohio corn" in b["text"], "Nov 2 issue: tagged in the text email")
    ok("utm_content=today-basis_wow" in b["text"], "Nov 2 issue: its link is counted as a Today click")
    ok("North Dakota" not in b["text"] and "Only on AGSIST" not in b["html"], "no North Dakota line, no count paragraph")
    ok(not V.check(daily, b)[0], "Nov 2 issue: the number check still passes")

if __name__ == "__main__":
    sys.exit(main())
