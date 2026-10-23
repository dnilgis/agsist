#!/usr/bin/env python3
"""
rain_month.py: one county's month just ended, in the county rain page's own
numbers (the monthly county rain email, subs worker v5.54, topic
rain-month:<fips>; scripts/send_rain_month.py sends it).

Everything here is read from files the site already publishes, and nothing is
made up:

  data/rain/<st>.json        the county page's month table (total, usual,
                             days reported, days) and its station. The month
                             and the year to date are the page's own rows,
                             added up; the percent uses the page's rule
                             (county_rain.PCT_MIN_NORMAL).
  data/rain/daily/<st>.json  the station's days, the same file the page's
                             Rain Print draws from: the month's day bars.
  data/drought/county-week.json  the U.S. Drought Monitor county figures
                             /drought-monitor shows (components/drought-county.js
                             words and categories).
  data/rain-month.json       the ask's wording, and whether pages show it.

One thing is not on the county page yet: the rank of the month against the
station's own record. Its earlier years come from NOAA's GHCN-Daily file for
the same station (the copy on AWS Open Data, noaa-ghcn-pds), months with
every day reported and passing NOAA's checks only. This year's number is
always the page's own. The rank is printed only when the GHCN file matches the
page on every month of this year both have whole (within 0.02 in), so the two
are the same gauge, and there are at least MIN_YEARS such years. Otherwise the
rank line is left out and says why.

The county rain page can print the same sentences: ask_html() is the ask,
and month_facts() + the *_words() functions are the email's lines.

    python3 scripts/rain_month.py --selftest
"""
import calendar
import csv
import html as H
import io
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import county_rain as R            # noqa: E402  months, station words, unpack_days, PCT_MIN_NORMAL
import build_county_rain as BCR    # noqa: E402  inch, inches_word, compare, where_words, short_date

ML = R.MONTHS_LONG
MIN_YEARS = 20          # fewer whole months on record: no rank
MATCH_IN = 0.02         # GHCN and the page agree this closely on every shared whole month
GHCN_URL = "https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/%s.csv"
GHCN_CREDIT = "NOAA GHCN-Daily"


# ---------------------------------------------------------------- the ask (county rain pages)
def ask_conf(repo=REPO):
    try:
        return json.load(open(os.path.join(repo, "data", "rain-month.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _attr(s):
    return BCR.e(s).replace("’", "&rsquo;")


def ask_html(name, fips, repo=REPO, conf=None):
    """The monthly ask for one county page, drawn by components/signup-ask.js
    (the Daily box starts unticked; "One more?" follows a signup). '' while
    data/rain-month.json says live: false, or for a FIPS the worker refuses."""
    c = ask_conf(repo) if conf is None else conf
    if not c.get("live") or not re.fullmatch(r"\d{5}", str(fips)) or str(fips)[2:] == "000":
        return ""
    f = lambda k: _attr(str(c[k]).replace("{county}", name))
    return (f'<div data-signup-ask="{f("ask")}" data-topic="rain-month:{fips}" data-btn="{f("btn")}" '
            f'data-ok="{f("ok")}" data-note="{f("note")}"></div>')


# ---------------------------------------------------------------- the month, in the page's numbers
def ordinal(n):
    return "%d%s" % (n, "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


def month_facts(c, year, m):
    """The month (0 = January) and the year to date through it, from the
    page's month table. None when the file has no row for that month."""
    rows = c.get("months") or []
    if m >= len(rows) or not rows[m][3]:
        return None
    t, u, rep, days = rows[m]
    whole_days = calendar.monthrange(year, m + 1)[1]
    last_day = days if days < whole_days else whole_days       # the month runs to the station's last day reported
    ytd = rows[:m + 1]
    y_t = round(sum(x[0] for x in ytd), 2)
    has_u = all(x[1] is not None for x in ytd)
    y_u = round(sum(x[1] for x in ytd), 2) if has_u else None
    y_p = round(100 * y_t / y_u) if y_u is not None and y_u >= R.PCT_MIN_NORMAL else None
    m_p = round(100 * t / u) if u is not None and u >= R.PCT_MIN_NORMAL else None
    return {"m": m, "year": year, "total": t, "usual": u, "pct": m_p, "reported": rep, "days": days,
            "whole": days == whole_days, "last_day": last_day, "complete": days == whole_days and rep == days,
            "ytd": y_t, "ytd_usual": y_u, "ytd_pct": y_p,
            "ytd_reported": sum(x[2] for x in ytd), "ytd_days": sum(x[3] for x in ytd)}


def span(f):
    mon = ML[f["m"]]
    return mon if f["whole"] else "%s 1 to %d" % (mon, f["last_day"])


def month_words(f, c):
    """'September: 3.67 inches at the weather station in Cumberland, 0.06 inches more than usual for the month (102%).'"""
    s = "%s: %s at %s" % (span(f), BCR.inches_word(f["total"]), BCR.where_words(c))
    if not f["whole"]:
        s += ", the last day it has reported"
    if f["usual"] is None:
        s += ". This %s has no NOAA normal, so there is no usual month to compare it with." % ("gauge" if c["station"]["net"] == "cocorahs" else "station")
    else:
        d = f["total"] - f["usual"]
        tail = "about the same as usual" if abs(d) < 0.05 else "%s %s than usual" % (BCR.inches_word(abs(d)), "more" if d > 0 else "less")
        s += ", %s for %s (usual %s%s)." % (tail, "those days" if not f["whole"] else "the month", BCR.inch(f["usual"]),
                                           ", %d%% of usual" % f["pct"] if f["pct"] is not None else "")
    if f["reported"] < f["days"]:
        miss = f["days"] - f["reported"]
        s += " It missed %s, counted as unknown, not as dry." % BCR.days_word(miss)
    return s


def ytd_words(f, c):
    """The year to date, said the way the page says it (build_county_rain.compare)."""
    end = "%s %d" % (R.MONTHS[f["m"]], f["last_day"])
    s = "Year to date, Jan 1 to %s: %s." % (end, BCR.inches_word(f["ytd"]))
    pseudo = {"usual": f["ytd_usual"], "pct": f["ytd_pct"], "total": f["ytd"], "as_of": "%d-%02d-%02d" % (f["year"], f["m"] + 1, f["last_day"]),
              "station": c["station"]}
    return s + " " + BCR.compare(pseudo, "a usual year to date")


# ---------------------------------------------------------------- the station's own record (rank)
def ghcn_id(sid):
    """ACIS sid "471923 2" (co-op) -> USC00471923, "14936 1" (WBAN) -> USW00014936,
    "US1SDBN0020 6" (GHCN) -> itself. None for anything else."""
    p = str(sid or "").split(" ")
    if len(p) != 2:
        return None
    i, t = p
    if t == "2" and re.fullmatch(r"\d{6}", i):
        return "USC00" + i
    if t == "1" and re.fullmatch(r"\d{5}", i):
        return "USW000" + i
    if t == "6" and re.fullmatch(r"[A-Z0-9]{11}", i):
        return i
    return None


def ghcn_months(text):
    """{(year, month): total inches} for every month with a PRCP value on every
    day and no quality flag. Each day is rounded to hundredths, as the page's
    daily values are."""
    days = {}
    for r in csv.reader(io.StringIO(text)):
        if len(r) < 6 or r[2] != "PRCP" or r[5] or not re.fullmatch(r"\d{8}", r[1]):
            continue
        try:
            v = int(r[3])
        except ValueError:
            continue
        if v < 0:
            continue
        y, m, d = int(r[1][:4]), int(r[1][4:6]), int(r[1][6:])
        days.setdefault((y, m), {})[d] = round(v / 254.0, 2)
    return {k: round(sum(v.values()), 2) for k, v in days.items()
            if len(v) == calendar.monthrange(k[0], k[1])[1]}


def rank(f, c, hist):
    """{"n", "first", "rank", "dir", "tied"} for this month against every whole
    same month on the station's record, or {"why": ...} when it cannot be said."""
    if hist is None:
        return {"why": "down"}
    if not f["complete"]:
        return {"why": "partial"}
    year, m = f["year"], f["m"]
    rows = c.get("months") or []
    shared = [(i, rows[i][0]) for i in range(len(rows)) if rows[i][3] == rows[i][2] == calendar.monthrange(year, i + 1)[1]
              and (year, i + 1) in hist]
    if not shared or any(abs(hist[(year, i + 1)] - t) > MATCH_IN for i, t in shared):
        return {"why": "nomatch"}
    past = {y: v for (y, mm), v in hist.items() if mm == m + 1 and y < year}
    if len(past) + 1 < MIN_YEARS:
        return {"why": "short"}
    vals = list(past.values()) + [f["total"]]
    wetter = sum(1 for v in vals if v > f["total"] + 1e-9)
    drier = sum(1 for v in vals if v < f["total"] - 1e-9)
    same = len(vals) - wetter - drier - 1
    wet = wetter <= drier
    return {"n": len(vals), "first": min(past), "rank": (wetter if wet else drier) + 1, "dir": "wettest" if wet else "driest",
            "tied": same}


def rank_words(f, c, rk):
    noun = "gauge" if c["station"]["net"] == "cocorahs" else "station"
    why = rk.get("why")
    if why == "down":
        return "The %s's past record did not load this time, so there is no rank against it this month." % noun
    if why == "partial":
        return "No rank this month: the %s has not reported every day of %s yet." % (noun, ML[f["m"]])
    if why == "nomatch":
        return "No rank this month: NOAA's long record for this %s does not line up with this year's numbers well enough to compare." % noun
    if why == "short":
        return "No rank this month: the %s has fewer than %d %ss with every day reported." % (noun, MIN_YEARS, ML[f["m"]])
    r = rk["rank"]
    place = "the %s" % rk["dir"] if r == 1 else "the %s %s" % (ordinal(r), rk["dir"])
    tie = " (tied with %s)" % ("one other year" if rk["tied"] == 1 else "%d other years" % rk["tied"]) if rk["tied"] else ""
    return "That makes it %s%s of %d %ss on this %s's record, %d to %d, counting the years it reported every day." % (
        place, tie, rk["n"], ML[f["m"]], noun, rk["first"], f["year"])


# ---------------------------------------------------------------- drought (components/drought-county.js words)
CAT = ["abnormally dry (D0)", "in drought (D1)", "in severe drought (D2)", "in extreme drought (D3)", "in exceptional drought (D4)"]


def _f1(v):
    s = "%.1f" % (round(v * 10) / 10)
    return s[:-2] if s.endswith(".0") else s


def worst(row):
    """The worst category touching any part of the county, -1 for none."""
    return max((i for i, v in enumerate(row or []) if v and v > 0), default=-1)


def drought_rows(w, fips):
    if not w or not w.get("valid"):
        return None
    rows = (w.get("c") or {}).get(fips)
    if not rows and fips in (w.get("zero") or []):
        rows = [[0, 0, 0, 0, 0]] * 3
    return rows


def drought_words(w, fips):
    """One or two sentences on the U.S. Drought Monitor map, newest against four weeks before.
    None when the file is not there."""
    if not w or not w.get("valid"):
        return None
    rows = drought_rows(w, fips)
    day = lambda iso: BCR.long_date(iso)
    if not rows:
        return "The U.S. Drought Monitor has no county figure for this county on the map valid %s." % day(w["valid"])
    now, then = rows[0], rows[2]
    k_now, k_then = worst(now), worst(then) if then else None

    def state(row, k):
        if k < 0:
            return "no part of it dry or in drought"
        if k == 0:
            return "%s%% of it abnormally dry (D0), none in drought" % _f1(row[0])
        s = "%s%% of it in drought (D1 or worse)" % _f1(row[1])
        if k >= 2:
            s += ", the worst part %s" % CAT[k].replace("in ", "", 1)
        return s
    s = "Drought Monitor, map valid %s: %s." % (day(w["valid"]), state(now, k_now))
    if then is None or not w.get("prev4"):
        return s[0].upper() + s[1:]
    if k_then == k_now and (k_now < 1 or abs(now[1] - then[1]) < 0.05):
        s += " Four weeks before (%s) it was the same." % day(w["prev4"])
    else:
        move = "worse" if k_now > k_then or (k_now == k_then and now[1] > then[1]) else "better"
        s += " That is %s than four weeks before (%s), when it was %s." % (move, day(w["prev4"]), state(then, k_then))
    return s


# ---------------------------------------------------------------- one plain line on the field
SEASON = {0: "winter", 1: "winter", 11: "winter", 2: "spring", 3: "spring", 4: "spring",
          5: "summer", 6: "summer", 7: "summer", 8: "fall", 9: "fall", 10: "fall"}
FIELD = {
    "winter": ("A dry winter month puts less water back in the soil for spring.",
               "About a usual winter month for putting water back in the soil.",
               "A wet winter month puts water back in the soil, if the ground was open when it came."),
    "spring": ("A dry spring month makes for planting days, and leaves less in the soil for later.",
               "About a usual spring month: planting days and soil water both about where they should be.",
               "A wet spring month means fewer planting days and wet spots that drown out."),
    "summer": ("A dry summer month is when the crop feels it most, first on light ground.",
               "About usual rain for a month when the crop is using a lot of water.",
               "A wet summer month keeps the crop going, but low spots that stand in water suffer."),
    "fall": ("A dry fall month means a quick harvest and fast drydown, and less water stored for next year.",
             "About a usual fall month for harvest and drydown.",
             "A wet fall month slows harvest and drydown and leaves fields soft."),
}
DROUGHT_FIELD = "Most of the county is still in drought on the latest map, so one month like this does not make up the shortfall."


def field_line(f, w=None, fips=""):
    """None without a usual month to compare with."""
    if f["pct"] is None:
        return None
    band = 0 if f["pct"] < 75 else 2 if f["pct"] > 125 else 1
    rows = drought_rows(w, fips) if w else None
    if band < 2 and rows and rows[0] and rows[0][1] >= 50:
        return DROUGHT_FIELD
    return FIELD[SEASON[f["m"]]][band]


# ---------------------------------------------------------------- the month's days, as bars (no image file)
def month_days(day, year, m):
    """The month's daily values from data/rain/daily (unpacked), or []."""
    if not day or not day.get("p"):
        return []
    vals = R.unpack_days(day["p"])
    start = sum(calendar.monthrange(year, i + 1)[1] for i in range(m))
    return vals[start:start + calendar.monthrange(year, m + 1)[1]]


def bars_html(vals, f):
    """A strip of one bar per day, as table cells (mail clients drop SVG and
    block images): a plain picture of the month, with the biggest day named.
    '' when the file has no days for it."""
    if not vals:
        return ""
    num = []
    for v in vals:
        try:
            num.append(float(str(v).rstrip("A")))
        except ValueError:
            num.append(None)
    top = max([x for x in num if x is not None] + [0.0])
    scale = max(top, 0.5)
    H_PX = 60
    cells = []
    for i, x in enumerate(num):
        if x is None:
            h, col, tip = 3, "#c9c2b4", "%s %d: no report" % (R.MONTHS[f["m"]], i + 1)
        else:
            h = max(1, int(round(H_PX * x / scale))) if x > 0 else 1
            col = "#2f6f8f" if x > 0 else "#e7e1d5"
            tip = "%s %d: %s in" % (R.MONTHS[f["m"]], i + 1, BCR.inch(x)) + (" (several days in one reading)" if str(vals[i]).endswith("A") else "")
        cells.append('<td style="vertical-align:bottom;padding:0 1px;height:%dpx" title="%s">'
                     '<div style="height:%dpx;line-height:%dpx;font-size:1px;background:%s">&nbsp;</div></td>' % (H_PX, H.escape(tip), h, h, col))
    big = max(range(len(num)), key=lambda i: num[i] if num[i] is not None else -1)
    cap = ("Each bar is one day's reading. Biggest: %s on %s %d." % (BCR.inches_word(num[big]), ML[f["m"]], big + 1)
           if num[big] else "Not one day with measurable rain.")
    if any(x is None for x in num):
        cap += " Gray: no report that day."
    return ('<table role="img" aria-label="%s" cellpadding="0" cellspacing="0" style="width:100%%;max-width:420px;border-collapse:collapse;'
            'table-layout:fixed;border-bottom:1px solid #8a7f6a;margin:4px 0 4px"><tr>%s</tr></table>'
            '<p style="font-size:12px;color:#6b6b6b;line-height:1.4;margin:0 0 14px">%s</p>') % (
        H.escape("%s rain, day by day. %s" % (span(f), cap)), "".join(cells), H.escape(cap))


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ok(cond, name, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    stn = {"ll": [-92.02, 45.53], "mi": 11.3, "name": "Cumberland", "net": "noaa", "raw": "CUMBERLAND", "sid": "471923 2"}
    c = {"name": "Barron County", "station": stn, "as_of": "2026-10-18",
         "months": [[1.11, 0.95, 31, 31], [0.73, 0.99, 28, 28], [1.76, 1.69, 31, 31], [6.25, 2.83, 30, 30], [2.08, 3.84, 31, 31],
                    [5.52, 4.54, 30, 30], [4.12, 4.47, 31, 31], [1.75, 4.4, 31, 31], [3.67, 3.61, 30, 30], [1.06, 2.13, 18, 18]]}
    f = month_facts(c, 2026, 8)
    ok(f["total"] == 3.67 and f["usual"] == 3.61 and f["pct"] == 102 and f["complete"], "September is the page's row", f)
    ok(f["ytd"] == 26.99 and f["ytd_usual"] == 27.32 and f["ytd_pct"] == 99, "year to date is the page's rows added up", f)
    ok(month_words(f, c) == "September: 3.67 inches at the weather station in Cumberland, 0.06 inches more than usual for the month (usual 3.61, 102% of usual).",
       "month sentence", month_words(f, c))
    ok(ytd_words(f, c) == "Year to date, Jan 1 to Sep 30: 26.99 inches. That is 0.33 inches less than a usual year to date (99% of usual).",
       "year to date sentence, the page's compare()", ytd_words(f, c))
    fo = month_facts(c, 2026, 9)
    ok(not fo["whole"] and fo["last_day"] == 18 and month_words(fo, c).startswith("October 1 to 18: 1.06 inches at the weather station in Cumberland, the last day it has reported, 1.07 inches less than usual for those days"),
       "a month still coming in says through which day", month_words(fo, c))
    ok(month_facts(c, 2026, 10) is None, "no row, no facts")
    # the record
    ok(ghcn_id("471923 2") == "USC00471923" and ghcn_id("14936 1") == "USW00014936" and ghcn_id("US1SDBN0020 6") == "US1SDBN0020"
       and ghcn_id("1234 3") is None and ghcn_id("") is None, "GHCN ids")

    def csvof(rows):
        return "ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME\n" + "\n".join(rows)

    def month_rows(y, m, total_tenths, qflag="", skip=0):
        n = calendar.monthrange(y, m)[1]
        out = []
        for d in range(1, n + 1 - skip):
            v = total_tenths if d == 1 else 0
            out.append("USC00471923,%d%02d%02d,PRCP,%d,,%s,7,0800" % (y, m, d, v, qflag))
        return out
    rows = []
    for y in range(1990, 2026):
        rows += month_rows(y, 9, 254 * (y - 1985) // 10)      # 0.50 .. 4.00 in
    rows += month_rows(1989, 9, 2540, skip=1)                 # a day missing: not whole
    rows += month_rows(1988, 9, 2540, qflag="X")              # failed a check: not whole
    rows += month_rows(2026, 1, 282) + month_rows(2026, 2, 185)   # 1.11 and 0.73, the page's own
    hist = ghcn_months(csvof(rows + ["USC00471923,19900901,TMAX,200,,,7,"]))
    ok((1989, 9) not in hist and (1988, 9) not in hist and hist[(1990, 9)] == 0.5 and hist[(2026, 1)] == 1.11, "whole months only", sorted(hist)[:3])
    rk = rank(f, c, hist)
    # 3.67 vs 0.50..4.00 by 0.10 (truncated tenths): the years above 3.67 are 3.70..4.00 at most
    wetter = sum(1 for (y, m), v in hist.items() if m == 9 and v > 3.67)
    ok(rk.get("dir") == "wettest" and rk["rank"] == wetter + 1 and rk["n"] == 37 and rk["first"] == 1990, "rank among whole Septembers", rk)
    ok(rank_words(f, c, rk) == "That makes it the %s wettest of 37 Septembers on this station's record, 1990 to 2026, counting the years it reported every day." % ordinal(wetter + 1),
       "rank sentence", rank_words(f, c, rk))
    bad = dict(hist)
    bad[(2026, 1)] = 1.50
    ok(rank(f, c, bad) == {"why": "nomatch"}, "GHCN that does not match the page: no rank")
    ok(rank(f, c, {k: v for k, v in hist.items() if k[0] != 2026}) == {"why": "nomatch"}, "nothing to match on: no rank")
    ok(rank(fo, c, hist) == {"why": "partial"} and rank(f, c, None) == {"why": "down"}, "partial month or no file: no rank")
    short = {k: v for k, v in hist.items() if k[0] >= 2010}
    ok(rank(f, c, short) == {"why": "short"}, "under %d years: no rank" % MIN_YEARS)
    ok(ordinal(1) == "1st" and ordinal(2) == "2nd" and ordinal(11) == "11th" and ordinal(22) == "22nd" and ordinal(13) == "13th", "ordinals")
    lo = dict(c, months=c["months"][:8] + [[0.2, 3.61, 30, 30]])
    rlo = rank(month_facts(lo, 2026, 8), lo, hist)
    ok(rlo["dir"] == "driest" and rlo["rank"] == 1 and rank_words(month_facts(lo, 2026, 8), lo, rlo).startswith("That makes it the driest of 37"), "driest on record", rlo)
    # drought
    w = {"valid": "2026-10-20", "prev4": "2026-09-22", "c": {"55005": [[100, 100, 100, 0, 0], [100, 100, 100, 0, 0], [100, 100, 100, 0, 0]],
                                                               "01001": [[100, 22.6, 0, 0, 0], [100, 22.6, 0, 0, 0], [100, 70.2, 18.4, 0, 0]],
                                                               "01003": [[29.3, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]},
         "zero": ["19169"]}
    ok(drought_words(w, "55005") == "Drought Monitor, map valid Oct 20, 2026: 100% of it in drought (D1 or worse), the worst part severe drought (D2). Four weeks before (Sep 22, 2026) it was the same.",
       "drought: unchanged", drought_words(w, "55005"))
    ok(drought_words(w, "01001") == "Drought Monitor, map valid Oct 20, 2026: 22.6% of it in drought (D1 or worse). That is better than four weeks before (Sep 22, 2026), when it was 70.2% of it in drought (D1 or worse), the worst part severe drought (D2).",
       "drought: better", drought_words(w, "01001"))
    ok(drought_words(w, "01003").endswith("That is worse than four weeks before (Sep 22, 2026), when it was no part of it dry or in drought."), "drought: worse", drought_words(w, "01003"))
    ok(drought_words(w, "19169") == "Drought Monitor, map valid Oct 20, 2026: no part of it dry or in drought. Four weeks before (Sep 22, 2026) it was the same.",
       "drought: none", drought_words(w, "19169"))
    ok(drought_words(w, "99999").startswith("The U.S. Drought Monitor has no county figure") and drought_words(None, "55005") is None, "drought: missing")
    # field
    ok(field_line(f, w, "55005") == DROUGHT_FIELD and field_line(f, w, "19169") == FIELD["fall"][1], "field line: drought first, else the season", field_line(f, w, "19169"))
    ok(field_line(dict(f, pct=None)) is None and field_line(dict(f, pct=140)) == FIELD["fall"][2] and field_line(dict(f, pct=60, m=6)) == FIELD["summer"][0],
       "field line bands")
    # bars
    vals = ["0.00"] * 30
    vals[8], vals[14], vals[20] = "1.20", "0.40A", "M"
    b = bars_html(vals, f)
    ok(b.count("<td ") == 30 and "Biggest: 1.20 inches on September 9." in b and "Gray: no report that day." in b and "several days in one reading" in b, "day bars", b[-300:])
    ok(bars_html([], f) == "", "no days, no bars")
    # the ask
    off = {"live": False, "ask": "Email me {county}’s rain at the start of each month.", "btn": "Email me", "ok": "Done.", "note": "One a month."}
    ok(ask_html("Barron County", "55005", conf=off) == "", "the ask stays off until data/rain-month.json says live")
    on = dict(off, live=True)
    a = ask_html("Barron County", "55005", conf=on)
    ok(a == '<div data-signup-ask="Email me Barron County&rsquo;s rain at the start of each month." data-topic="rain-month:55005" data-btn="Email me" data-ok="Done." data-note="One a month."></div>',
       "the ask: county, topic, wording from the data key", a)
    ok(ask_html("Barron County", "55000", conf=on) == "" and ask_html("X", "5500", conf=on) == "", "a FIPS the worker refuses gets no ask")
    real = ask_conf()
    ok(real.get("live") is False and "{county}" in real.get("ask", "") and not re.search("[–—]", json.dumps(real, ensure_ascii=False)),
       "data/rain-month.json: off, names the county, no dashes")
    txt = " ".join([month_words(f, c), ytd_words(f, c), rank_words(f, c, rk), drought_words(w, "01001")] + [x for t in FIELD.values() for x in t] + [DROUGHT_FIELD])
    ok(not re.search("[–—]|&mdash;|&ndash;|!", txt), "no dashes, no exclamation marks")
    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(0)
