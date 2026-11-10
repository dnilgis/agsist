#!/usr/bin/env python3
"""
daily_more.py -- what a farmer should know that morning, handed to the Daily's
writer as dated data (Nov 2 2026 audit: a DTN or Pro Farmer reader got these on
Monday Nov 2 and the Daily did not; Nov 1). Every number here is read from a file already in the repo. Nothing is
fetched and nothing is forecast. A block whose file is missing, stale, out of
season or not yet public when the issue is written is WITHHELD, with the reason,
never filled in.

THE BLOCKS (prompt_block joins the ones that are on, each with its source and date)
  calendar   USDA reports today and tomorrow, the next WASDE with its date and
             days away, and FSA signup dates: a signup that opened in the last
             7 days, any FSA date today or tomorrow, a deadline within 45 days.
             Sources: usda-calendar.ics (built from the list on /usda-calendar by
             scripts/build_usda_ics.mjs, the same list the homepage strip
             reads), the weekly rules in scripts/usda_dates.py (Crop Progress,
             Export Sales) and the homepage strip's Export Inspections rule
             (components/home.js: Monday 11:00 AM ET; a Monday federal holiday
             moves it to the next business day, as usda_dates does for Crop
             Progress). test_daily_more.py pins the copy against home.js.
  harvest    Monday and Tuesday issues only: US corn and soybean harvest
             percent from data/crop-progress.json, its week-ending date, the
             week before, and the 5-year average or last year only when the
             file carries them. Only the newest report public when the issue
             is written: NASS releases the Monday after the week ends, 3:00 PM
             CT, or the next business day after a Monday federal holiday. An
             older week (a missed fetch, the season over) or a newer one
             (look-ahead) is withheld, as is a file that says out of season.
  funds      the Saturday issue after the CFTC release, once per release (Nov 9 2026; was Saturday and Monday, Nov 2): managed
             money's net position and its change, futures only, for corn,
             soybeans, Chicago wheat and live cattle, from data/cot.json and
             data/cot-history.json through scripts/send_cot_weekly.rows_for,
             plus how the net changed (longs and shorts), the line
             data/cot-analysis.json carries (card.how)
             (the same rows "Funds this week" and /cot print, never worked out
             a second way). Release day from scripts/cot_calendar.py, 3:30 PM
             ET; withheld before it, after FUND_MAX_DAYS, or when the files do
             not agree on the report.

The fourth item of the brief, the basis line in the Today list, is made by
code in scripts/daily_v2.py from scripts/only_here.py; the writer never sees it.

    python3 scripts/daily_more.py                         print today's block
    python3 scripts/daily_more.py --date 2026-11-02 --now 2026-11-02T11:00:00Z
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import sys
from datetime import date, datetime, time, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import usda_dates  # noqa: E402  the weekly release rules and the WASDE dates

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
    ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    CT = timezone(timedelta(hours=-6))
    ET = timezone(timedelta(hours=-5))

ICS_PATH = os.path.join(REPO, "usda-calendar.ics")
CROP_PATH = os.path.join(REPO, "data", "crop-progress.json")

# components/home.js line `{name:'Export Inspections',wd:1,h:11,mi:0}`: Monday, 11:00 AM ET.
INSPECTIONS_WEEKDAY = 0
INSPECTIONS_ET = (11, 0)
FSA_OPENED_DAYS = 7        # "the signup opened Monday" stays in the block for a week
FSA_DEADLINE_DAYS = 45     # a deadline closer than this is counted down
WASDE_DAYS = 35            # the next WASDE is named when it is this close (always, in practice)
HARVEST_DAYS = (0, 1)      # Monday and Tuesday issues
CROP_PROGRESS_HOUR_CT = 15
FUND_MARKETS = ("corn", "beans", "wheat", "livecattle")
FUND_DAYS = (5,)           # Saturday only, once per release (Nov 9 2026)
FUND_MAX_DAYS = 6          # a Friday release is 1 day back; a Monday release in a holiday week, 5


def _md(d):
    return "%s %d" % (d.strftime("%b"), d.day)


def _day(d, today=None):
    """'Monday, Nov 2'; the year added when it is not today's year."""
    s = "%s, %s" % (d.strftime("%A"), _md(d))
    return s + (", %d" % d.year) if today and d.year != today.year else s


def _clock(dt):
    h = dt.hour % 12 or 12
    return "%d:%02d %s" % (h, dt.minute, "AM" if dt.hour < 12 else "PM")


def _when_words(d, today):
    n = (d - today).days
    return "today" if n == 0 else ("tomorrow" if n == 1 else "%d days away" % n)


# ── the calendar ───────────────────────────────────────────────────────────
def read_ics(path=ICS_PATH):
    """[{summary, uid, date, at_ct (datetime or None for all day)}] from the
    calendar file, or [] when it cannot be read."""
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return []
    lines = []
    for ln in raw.replace("\r\n", "\n").split("\n"):
        if ln.startswith(" ") and lines:
            lines[-1] += ln[1:]
        else:
            lines.append(ln)
    out, cur = [], None
    for ln in lines:
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT" and cur is not None:
            if cur.get("date") and cur.get("summary"):
                out.append(cur)
            cur = None
        elif cur is not None and ":" in ln:
            k, v = ln.split(":", 1)
            name = k.split(";")[0]
            if name == "SUMMARY":
                cur["summary"] = v.replace("\\,", ",").replace("\\;", ";").strip()
            elif name == "UID":
                cur["uid"] = v.strip()
            elif name == "DTSTART":
                try:
                    if "VALUE=DATE" in k:
                        cur["date"], cur["at_ct"] = datetime.strptime(v.strip(), "%Y%m%d").date(), None
                    else:
                        utc = datetime.strptime(v.strip(), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                        at = utc.astimezone(CT)
                        cur["date"], cur["at_ct"] = at.date(), at
                except ValueError:
                    pass
    return out


def _is_fsa(ev):
    return ev["summary"].endswith("(FSA)")


def _fsa_name(ev):
    return re.sub(r"\s*\(FSA\)$", "", ev["summary"])


def inspections_date(day):
    """The Export Inspections release of the week containing `day`: Monday,
    or the next business day after a Monday federal holiday."""
    mon = day - timedelta(days=day.weekday()) + timedelta(days=INSPECTIONS_WEEKDAY)
    return usda_dates.next_business_day(mon) if usda_dates.federal_holiday_name(mon) else mon


def _inspections_ct(d):
    return datetime.combine(d, time(*INSPECTIONS_ET), tzinfo=ET).astimezone(CT)


def _export_sales_hedge(d):
    """generate_daily.export_sales_holiday_week's case, from usda_dates alone:
    a federal holiday Monday to Wednesday of that week, Thursday itself open."""
    mon = d - timedelta(days=d.weekday())
    if any(usda_dates.federal_holiday_name(mon + timedelta(days=i)) for i in range(3)):
        return " (a holiday week: FAS often releases a day late, so say Thursday or Friday)"
    return ""


def reports_on(day, events):
    """[(name, time words)] of USDA reports on `day`: the weekly ones by rule,
    the rest from the calendar file. FSA dates are not reports."""
    out = []
    if inspections_date(day) == day:
        out.append(("USDA Export Inspections", _clock(_inspections_ct(day)) + " CT"))
    for name, at, moved in usda_dates.weekly_releases(day):
        note = ""
        if moved:
            note = " (moved from %s, %s)" % (moved.strftime("%A"), usda_dates.federal_holiday_name(moved))
        if "Export Sales" in name:
            note += _export_sales_hedge(day)
        out.append((name, at + note))
    for ev in events:
        if ev["date"] == day and not _is_fsa(ev):
            when = (_clock(ev["at_ct"]) + " CT") if ev.get("at_ct") else "all day"
            nm = ev["summary"] if ev["summary"] != "WASDE" else "USDA WASDE"
            out.append((nm, when))
    return out


def calendar_facts(today, events=None, path=ICS_PATH):
    """{"lines": [...], "source": str} or {"withheld": why}."""
    if events is None:
        events = read_ics(path)
    if not events:
        return {"withheld": "the report calendar file is missing or empty"}
    lines = []
    for d in (today, today + timedelta(days=1)):
        reps = reports_on(d, events)
        if d.weekday() >= 5 and not reps:
            continue
        head = "Today (%s)" % _day(d) if d == today else "Tomorrow (%s)" % _day(d)
        lines.append("%s: %s." % (head, "; ".join("%s, %s" % r for r in reps) if reps else "no USDA report on the calendar"))
    nw = usda_dates.next_wasde(today)
    if nw and (nw - today).days <= WASDE_DAYS and nw > today + timedelta(days=1):
        lines.append("Next WASDE: %s, 11:00 AM CT, %d days away." % (_day(nw, today), (nw - today).days))
    fsa = sorted((ev for ev in events if _is_fsa(ev)), key=lambda ev: ev["date"])
    for ev in fsa:
        n = (ev["date"] - today).days
        name = _fsa_name(ev)
        if re.search(r"\bopens$", name) and -FSA_OPENED_DAYS <= n <= 1:
            what = re.sub(r"\s+opens$", "", name)
            s = "the %s %s at county FSA offices" % (
                what, "opened %s" % _day(ev["date"], today) if n < 0 else "opens " + _when_words(ev["date"], today))
            year = re.match(r"(\d{4}) ", name)
            close = [x for x in fsa if year and x["summary"].startswith(year.group(1)) and "deadline" in x["summary"].lower()
                     and x["date"] > ev["date"]]
            if close:
                s += " and runs to %s" % _day(close[0]["date"], today)
            lines.append("FSA: " + s + ".")
        elif "deadline" in name.lower() and 0 <= n <= FSA_DEADLINE_DAYS:
            lines.append("FSA: %s is %s, %s." % (name, _day(ev["date"], today),
                                                 "TODAY" if n == 0 else _when_words(ev["date"], today)))
        elif 0 <= n <= 1:
            lines.append("FSA: %s, %s%s." % (name, _day(ev["date"], today),
                                             (" " + _clock(ev["at_ct"]) + " CT") if ev.get("at_ct") else ""))
    return {"lines": lines,
            "source": ("AGSIST's USDA report calendar (/usda-calendar): USDA NASS, AMS and FAS release schedules; "
                       "FSA dates from USDA's Sept 15, 2026 enrollment notice. Read %s." % _day(today))}


# ── harvest progress ───────────────────────────────────────────────────────
def crop_progress_release(week_end):
    """When NASS published the Crop Progress for the week ending `week_end`
    (a Sunday): the next Monday, or the next business day after a Monday
    federal holiday, at 3:00 PM CT."""
    mon = week_end + timedelta(days=(7 - week_end.weekday()) % 7 or 7)
    d = usda_dates.next_business_day(mon) if usda_dates.federal_holiday_name(mon) else mon
    return datetime.combine(d, time(CROP_PROGRESS_HOUR_CT, 0), tzinfo=CT)


def latest_public_week(now):
    """The week-ending Sunday of the newest Crop Progress public at `now`."""
    d = now.astimezone(CT).date()
    sun = d - timedelta(days=(d.weekday() + 1) % 7)
    for k in range(4):
        w = sun - timedelta(days=7 * k)
        if crop_progress_release(w) <= now:
            return w
    return None


def _pct_int(v):
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 100


def harvest_facts(today, now, path=CROP_PATH):
    """{"lines", "source", "week_end"} or {"withheld": why}."""
    if today.weekday() not in HARVEST_DAYS:
        return {"withheld": "harvest pace runs on Monday and Tuesday issues"}
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {"withheld": "data/crop-progress.json missing or unreadable"}
    if d.get("in_season") is not True:
        return {"withheld": "Crop Progress is out of season"}
    prog = d.get("progress") or {}
    lines, weeks = [], set()
    for key, name in (("corn_harvested", "Corn"), ("soybeans_harvested", "Soybeans")):
        r = prog.get(key) or {}
        try:
            we = date.fromisoformat(str(r.get("date") or ""))
        except ValueError:
            continue
        if not _pct_int(r.get("pct")):
            continue
        # only the newest report public when the issue is written: an older week
        # is stale (a missed fetch), a newer one is look-ahead
        if we >= today or we != latest_public_week(now):
            continue
        s = "%s %d%% harvested in the week ending %s" % (name, r["pct"], _day(we))
        if _pct_int(r.get("prev_week")):
            gain = r["pct"] - r["prev_week"]
            s += ", up %d point%s from %d%% the week before" % (gain, "" if gain == 1 else "s", r["prev_week"])
        if _pct_int(r.get("avg5")):
            s += "; 5-year average %d%%" % r["avg5"]
        if _pct_int(r.get("prev_year")):
            s += "; last year %d%%" % r["prev_year"]
        lines.append(s + ".")
        weeks.add(we)
    if not lines:
        return {"withheld": "no harvest figure for a week that was public by this issue (stale or not yet released)"}
    we = max(weeks)
    rel = crop_progress_release(we)
    return {"lines": lines, "week_end": we.isoformat(),
            "source": "USDA NASS Crop Progress, released %s, 3:00 PM CT." % _day(rel.date())}


# ── fund positions ─────────────────────────────────────────────────────────
def fund_facts(today, now, repo=REPO):
    """{"lines", "source", "as_of", "released"} or {"withheld": why}."""
    import cot_calendar
    import send_cot_weekly as CW
    cot = CW.load(os.path.join(repo, "data", "cot.json"))
    as_of = CW.as_of_date(cot)
    if not as_of:
        return {"withheld": "data/cot.json missing or has no report date"}
    if cot_calendar.release_unknown(as_of):
        return {"withheld": "a shutdown report: its release date is not known"}
    rel = cot_calendar.release_date(as_of)
    rel_at = datetime.combine(rel, time(15, 30), tzinfo=ET)
    if rel_at > now:
        return {"withheld": "the %s report was not out when this issue was written" % as_of.isoformat()}
    days = (today - rel).days
    if today.weekday() not in FUND_DAYS:
        return {"withheld": "fund positions run on the Saturday issue after the release"}
    if not 1 <= days <= FUND_MAX_DAYS:
        return {"withheld": "the latest report (released %s) is not this weekend's" % rel.isoformat()}
    hist = CW.load(os.path.join(repo, "data", "cot-history.json"))
    # the analysis file only for its card.how line (how the net changed, longs and shorts), the line /cot and the
    # email print; rows_for withholds it when that file is missing, on another week or disagrees with the history
    ana = CW.load(os.path.join(repo, "data", "cot-analysis.json"))
    rows = [r for r in CW.rows_for(cot, hist, None, as_of, ana) if r["key"] in FUND_MARKETS]
    if not rows:
        return {"withheld": "the COT files do not agree on this report"}
    lines = []
    for r in rows:
        s = CW.sentence(r)
        s = s.replace("Managed money is", "%s: managed money is" % r["name"], 1)
        if r.get("how"):
            s += " " + r["how"]
        lines.append(s)
    return {"lines": lines, "as_of": as_of.isoformat(), "released": rel.isoformat(),
            "source": ("CFTC Commitments of Traders, disaggregated, futures only, managed money; positions as of "
                       "%s, released %s, 3:30 PM ET." % (_day(as_of), _day(rel)))}


# ── the writer's block ─────────────────────────────────────────────────────
RULES = {
    "calendar": ("Name a report in the watch list with the day and time written here. A signup opening or a "
                 "deadline listed here goes in the watch list (or a top story the day it opens), with its date "
                 "exactly as written. Never a date, time or deadline that is not in this block or the calendar."),
    "harvest": ("Use it in a section or the lead as LAST WEEK's harvest pace, with 'week ending' and its date. "
                "Never write a 5-year average or a last-year figure this block does not carry, and never call "
                "it this week's progress."),
    "funds": ("Use it in a section body as positioning as of the Tuesday named here, released Friday. Contracts, "
              "never a percent; never call it this week's trading or say funds bought or sold today. 'Longs ..., shorts ...' is how "
              "the net changed: use those words as written and never give a reason or say what funds think."),
}
TITLES = {"calendar": "FARM CALENDAR", "harvest": "HARVEST PACE (last week)", "funds": "FUND POSITIONS (CFTC)"}


def build(today=None, now=None, repo=REPO):
    """{"calendar": {...}, "harvest": {...}, "funds": {...}}; each is
    {"lines", "source", ...} or {"withheld": why}. Fail-soft per block."""
    now = now or datetime.now(timezone.utc)
    today = today or now.astimezone(CT).date()
    out = {}
    for name, fn in (("calendar", lambda: calendar_facts(today, path=os.path.join(repo, "usda-calendar.ics"))),
                     ("harvest", lambda: harvest_facts(today, now, os.path.join(repo, "data", "crop-progress.json"))),
                     ("funds", lambda: fund_facts(today, now, repo))):
        try:
            out[name] = fn()
        except Exception as ex:
            out[name] = {"withheld": "could not be built (%s)" % type(ex).__name__}
    return out


def prompt_block(blocks):
    """The text handed to the writer, or "" when every block is withheld."""
    parts = []
    for name in ("calendar", "harvest", "funds"):
        b = blocks.get(name) or {}
        if not b.get("lines"):
            continue
        parts.append("%s (source: %s)\n  - %s\n  RULE: %s" % (TITLES[name], b["source"], "\n  - ".join(b["lines"]),
                                                              RULES[name]))
    if not parts:
        return ""
    return ("WHAT A FARMER SHOULD KNOW TODAY (computed from AGSIST's own files; every number below is checked "
            "against them, so copy numbers and dates exactly). Unlike the seasonal note above, this is not "
            "background: a report, signup or deadline dated today is new today and may lead or be a top story, "
            "and the harvest and fund numbers may be used where their rule says. Nothing here is repeated if "
            "ALREADY SAID THIS WEEK has it, unless it changed.\n" + "\n".join(parts))


def log_lines(blocks):
    return ["%s: %s" % (k, ("%d line(s)" % len(v["lines"])) if v.get("lines") else "withheld (%s)" % v.get("withheld"))
            for k, v in blocks.items()]


def main(argv):
    today, now = None, None
    if "--date" in argv:
        today = date.fromisoformat(argv[argv.index("--date") + 1])
    if "--now" in argv:
        now = datetime.fromisoformat(argv[argv.index("--now") + 1].replace("Z", "+00:00"))
    if today and not now:
        now = datetime.combine(today, time(6, 0), tzinfo=CT)
    blocks = build(today, now)
    for ln in log_lines(blocks):
        print(ln)
    print()
    print(prompt_block(blocks) or "(nothing for the writer today)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
