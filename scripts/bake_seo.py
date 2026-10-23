#!/usr/bin/env python3
"""
AGSIST — bake the answer into the title and the description.

WHY THIS EXISTS

The 2026-08-16 export said the traffic problem is not ranking any more. Google
impressions grew 230% in a month and click-through did not move at all: 1.30%
to 1.28%, with average position improving 13.5 to 10.3. The pages sitting in
the top ten are the ones being ignored.

    /usda-calendar      9,017 impressions  position 7.8   CTR 0.33%
    /usda-quick-stats   7,310              position 6.5   CTR 0.18%
    /cot                1,952              position 7.4   CTR 0.41%
    /breakeven          1,295              position 7.2   CTR 0.69%
    /crop-tour            471              position 7.0   CTR 0.42%

At position 7 a normal click-through is 2-4%. And the same shape shows in the
Bing-style report: 31 keywords holding a top-ten position with 24,682
impressions and 177 clicks between them.

The diagnosis is that these titles describe a TOOL and the searcher wants an
ANSWER. Somebody searching "wasde report schedule" against usda.gov in the same
result set does not pick "USDA Report Calendar 2026". They pick the one showing
the date.

So: lead with the answer, keep the keyword. Every title and description here is
computed from a live data file, which is the only way it can say a real number
and still be true next week. A page whose data is missing keeps whatever it has
-- this script never writes a placeholder, because a stale confident title is
worse than a dull accurate one.

RAILS

  - title <= TITLE_MAX chars, description <= DESC_MAX (the new-page checklist's
    160), both asserted before anything is written
  - no double quotes anywhere near a content= attribute
  - a computed date that has already passed is a bug, not a title: refuse
  - missing or unreadable data for a page skips that page loudly
  - a title may not claim a result the data file does not contain
  - --selftest runs offline against synthetic data and plants known failures

Stamps <title>, meta description, og:title, og:description, twitter:title and
twitter:description, so the SERP, the share card and the assistant summary all
say the same thing.
"""

import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pricefmt  # noqa: E402  grain price text, the twin of components/util.js AG.px

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
sys.path.insert(0, str(REPO / "scripts"))

from seo_caps import TITLE_MAX, DESC_MAX, SUFFIX, fit  # noqa: E402  the one cap (scripts/seo_caps.py)

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def mdY(d):
    return f"{MONTHS[d.month - 1][:3]} {d.day}, {d.year}"


def span(a, b):
    """Aug 17-20, 2026 — not Aug 17, 2026-Aug 20, 2026. Descriptions have a
    160-character cap and a repeated year is the cheapest thing to give up."""
    if a.year == b.year and a.month == b.month:
        return f"{MONTHS[a.month - 1][:3]} {a.day}–{b.day}, {a.year}"
    if a.year == b.year:
        return f"{MONTHS[a.month - 1][:3]} {a.day}–{MONTHS[b.month - 1][:3]} {b.day}, {a.year}"
    return f"{mdY(a)}–{mdY(b)}"


# ---------------------------------------------------------------- context

def _load(name):
    p = DATA / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:                                     # noqa: BLE001
        return None


def next_unprinted_wasde(today, wasde=None):
    """The next WASDE that has not printed yet. On report day, once
    data/wasde.json records today's release, the next one is next: the title
    read "Next WASDE: Oct 9" all afternoon after the Oct 9 print."""
    import usda_dates
    from datetime import timedelta
    w = usda_dates.next_wasde(today)
    if w and w == today and str((wasde or {}).get("release") or "")[:10] == w.isoformat():
        w = usda_dates.next_wasde(w + timedelta(days=1))
    return w


def build_ctx(today):
    return {
        "today": today,
        "next_wasde": next_unprinted_wasde(today, _load("wasde.json")),
        "cot": _load("cot.json"),
        "state_stats": _load("state-stats.json"),
        "crop_tour": _load("crop-tour.json"),
        "prices": _load("prices.json"),
        "cond_yield": _load("cond-yield/fit.json"),
        "yield_panel": _load("yield-panel.json"),
        "crop_progress": _load("crop-progress.json"),
        "basis": _load("transport/basis.json"),
        "fertilizer": _load("fertilizer-prices.json"),
        "dairy": _load("dairy-data.json"),
        "cal_reports": cal_reports(),
        "nass_years": nass_years(),
    }


def nass_years():
    """(first, last) year that BOTH the corn and soybean state yield series
    on /usda-quick-stats hold (the CSV download's range), or None. These are
    NASS finals only; the in-season forecast is not in them."""
    spans = []
    for f in ("corn-yield", "soy-yield"):
        ys = [y for y in ((_load(f"nass/{f}.json") or {}).get("years") or []) if isinstance(y, int)]
        if not ys:
            return None
        spans.append((min(ys), max(ys)))
    a, b = max(x[0] for x in spans), min(x[1] for x in spans)
    return (a, b) if a < b else None


# The REPORTS list in usda-calendar.html is the page's own schedule. The
# crop-report title and the two time/date FAQs read it, so a date the page
# moves is a date the snippet moves with it.
_CAL_ROW = re.compile(r"\{date:'(\d{4}-\d\d-\d\d)',name:'([^']*)',type:'([^']*)'(?:,tag:'[^']*')?,time:'([^']*)'")


def cal_reports(text=None):
    """[{date, name, type, time}] from usda-calendar.html's REPORTS, or None."""
    try:
        t = text if text is not None else (REPO / "usda-calendar.html").read_text(encoding="utf-8")
    except OSError:
        return None
    rows = [{"date": date.fromisoformat(d), "name": n, "type": ty, "time": tm}
            for d, n, ty, tm in _CAL_ROW.findall(t)]
    return rows or None


# ---------------------------------------------------------------- builders
# Each returns (title, description) or None to skip the page. Raising is fine:
# main() catches, reports and leaves the page alone.

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
WASDE_TIME = "noon ET (11 a.m. CT)"      # usda-calendar.html: every WASDE row is 12:00 PM ET


def next_crop_report(c):
    """(day, [report names]) for the next Crop Production on the page's own
    schedule, with every other USDA report the page lists at noon ET that
    day (the WASDE first), or None. On report day, once the WASDE has
    printed (next_wasde moved past today), that day is done and the next
    one is next, the same rule as the WASDE title."""
    rows = c.get("cal_reports") or []
    today, w = c["today"], c.get("next_wasde")
    days = sorted({r["date"] for r in rows if r["name"] == "Crop Production"
                   and r["type"] == "supply" and r["date"] >= today})
    if days and days[0] == today and w and w > today:
        days = days[1:]
    if not days:
        return None
    d = days[0]
    same = [r for r in rows if r["date"] == d and r["time"] == "12:00 PM ET"
            and r["type"] not in ("intl", "fsa", "outlook")]
    if not any(r["name"] == "Crop Production" for r in same):
        raise ValueError(f"Crop Production on {d} is not at 12:00 PM ET on the page")
    names = [r["name"] for r in same if r["type"] == "wasde"]
    names += [r["name"] for r in same if r["type"] != "wasde" and r["name"] not in names]
    return d, names


def _and(xs):
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]


def seo_usda_calendar(c):
    w = c["next_wasde"]
    if not w:
        # Past the end of the date table (after the last WASDE of the year,
        # until usda_dates.py gets next year's dates). Returning None here used
        # to leave "Next WASDE Dec 10" in the title for weeks after Dec 10.
        # Say what the page holds and name no date.
        return ("WASDE & USDA Report Dates: The Full USDA Calendar" + SUFFIX,
                "Every USDA report date and release time on one calendar: WASDE "
                f"at {WASDE_TIME}, Crop Production, Grain Stocks, Crop Progress.")
    if w < c["today"]:
        raise ValueError(f"next_wasde returned {w}, already in the past")
    when = "today" if w == c["today"] else WEEKDAYS[w.weekday()]
    # 2026-10-18 (Search Console, Jul to Oct 14): "next usda crop report" and
    # "what time" queries got no direct answer; the title and description
    # named the WASDE only. When the next WASDE comes with Crop Production
    # on the page's own schedule, both are named, and the description gives
    # the release time and the weekly Crop Progress time.
    # 2026-10-19 (Sig): the title stays the Oct 11 one every month, with no
    # Crop Production variant, and is left alone until the Nov 15 re-measure.
    # Only the description names Crop Production.
    title = f"WASDE & USDA Report Dates {w.year}: Next WASDE {MONTHS[w.month - 1][:3]} {w.day}{SUFFIX}"
    cr = next_crop_report(c)
    if cr and cr[0] == w:
        import usda_dates
        head = (f"Next USDA crop report: {_and(cr[1])}, {when}, {mdY(w)}, at {WASDE_TIME}.")
        tails = []
        if usda_dates.next_crop_progress(c["today"]):
            tails.append(" Crop Progress Mondays 4 p.m. ET. Every date on one calendar.")
            tails.append(" Crop Progress Mondays 4 p.m. ET.")
        tails += [" Every USDA report date on one calendar.", ""]
        for tail in tails:
            if len(head + tail) <= DESC_MAX:
                return title, head + tail
    # RETITLED 2026-10-11 from "Next WASDE: Nov 10, 2026 | USDA Report
    # Calendar". Over Jul 10-Oct 7 that title held position 7.4 on 46,503
    # impressions at 0.20% CTR, and the queries Search Console names are
    # about DATES: "wasde report dates" 437 impressions, "wasde report dates
    # 2026" 268, "next wasde report" 263, "usda report calendar" 253, "usda
    # report calendar 2026" 119. "dates" was the one word the old title
    # lacked. The next date stays in the title; the year is the WASDE's own.
    # The description names no year: in December the next WASDE is January's
    # while the calendar below may still hold this year's dates.
    #
    # 2026-10-13: the description gives the weekday and the release time in
    # place of "in 28 days". The count was right on the morning it was baked
    # and wrong every day after until the next bake (none on weekends), and
    # "wasde report today" (30 impressions) asks for the time, which never
    # goes stale.
    return (title,
            f"The next WASDE report is {when}, {mdY(w)}, at {WASDE_TIME}. Every "
            f"USDA report date on one calendar: WASDE, Crop Production, Grain Stocks.")


# Two FAQ answers on /usda-calendar are baked here, in the visible <details>
# AND the FAQPage JSON-LD, from the same string (render_faq_html.py --check
# compares them). The questions are the words people search.
Q_NEXT_CROP = "When is the next USDA crop report?"
Q_TIMES = "What time do USDA reports come out?"


def faq_next_crop(c):
    import usda_dates
    today = c["today"]
    cr = next_crop_report(c)
    w = c.get("next_wasde")
    if cr:
        d, names = cr
        when = "today" if d == today else WEEKDAYS[d.weekday()]
        many = len(names) > 1
        out = (f"USDA's next crop report{'s' if many else ''}, {_and(names)}, come{'' if many else 's'} out "
               f"{when}, {mdY(d)}, at 12:00 p.m. ET (11 a.m. CT).")
    elif w:
        when = "today" if w == today else WEEKDAYS[w.weekday()]
        out = (f"The next USDA crop numbers come with the WASDE, {when}, {mdY(w)}, at 12:00 p.m. ET "
               f"(11 a.m. CT). No more Crop Production reports are on this year's calendar.")
    else:
        return ("Every crop report on this year's USDA calendar is out. The next dates go on this "
                "page when USDA posts next year's calendar.")
    cp = usda_dates.next_crop_progress(today)
    last = usda_dates.CROP_PROGRESS_LAST.get(today.year)
    if cp and last:
        out += f" Crop Progress comes out Mondays at 4:00 p.m. ET through {mdY(last)}."
    return out


# report -> the time the answer prints for it; checked against the page's
# schedule on every bake, so the FAQ cannot drift from the calendar below it
_NOON = ("WASDE", "Crop Production", "Grain Stocks", "Prospective Plantings", "Acreage")
_THREE = ("Cattle on Feed", "Quarterly Hogs and Pigs", "Milk Production", "Cold Storage")


def faq_report_times(c):
    import usda_dates
    rows = c.get("cal_reports") or []
    if not rows:
        raise ValueError("no schedule rows read from usda-calendar.html")

    def times(nm):
        return {r["time"] for r in rows if r["name"] == nm or r["name"].startswith(nm + " (")}
    for names, want in ((_NOON, "12:00 PM ET"), (_THREE, "3:00 PM ET")):
        for nm in names:
            got = times(nm)
            if not got:
                raise ValueError(f"{nm} is not on the page's schedule")
            if got != {want}:
                raise ValueError(f"{nm} is at {sorted(got)} on the page, the FAQ says {want}")
    if usda_dates.CROP_PROGRESS_TIME_CT != "3:00 PM CT" or usda_dates.EXPORT_SALES_TIME_CT != "7:30 AM CT":
        raise ValueError("Crop Progress or Export Sales time changed in usda_dates.py")
    return ("The big crop reports come out at 12:00 p.m. ET (11 a.m. CT): WASDE, Crop Production, "
            "Grain Stocks, Prospective Plantings and Acreage. Cattle on Feed, Hogs and Pigs, Milk "
            "Production and Cold Storage come out at 3:00 p.m. ET (2 p.m. CT), the time NASS uses "
            "for most of its other reports. Crop Progress is out Mondays at 4:00 p.m. ET (3 p.m. CT) "
            "in season, and Export Sales Thursdays at 8:30 a.m. ET. Source: the NASS 2026 release "
            "calendar and USDA's WASDE schedule.")


FAQ_BAKE = {
    "usda-calendar.html": [(Q_NEXT_CROP, faq_next_crop), (Q_TIMES, faq_report_times)],
}


def bake_faq_answer(text, q, ans):
    """(text, ok). Sets question q's answer in the FAQPage JSON-LD and in the
    visible <details> to ans. ok is False unless each is found exactly once."""
    if any(ch in ans for ch in '"<>&\\') or any(ch in q for ch in '"<>&\\'):
        raise ValueError(f"FAQ text needs escaping, refusing: {ans!r}")
    ld = re.compile(r'("name":\s*"' + re.escape(q) + r'",\s*"acceptedAnswer":\s*\{\s*"@type":\s*"Answer",\s*"text":\s*")((?:[^"\\]|\\.)*)(")')
    vis = re.compile(r'(<summary>' + re.escape(q) + r'</summary><div class="agf-a">)(.*?)(</div></details>)', re.S)
    if len(ld.findall(text)) != 1 or len(vis.findall(text)) != 1:
        return text, False
    text = ld.sub(lambda m: m.group(1) + ans + m.group(3), text)
    text = vis.sub(lambda m: m.group(1) + ans + m.group(3), text)
    return text, True


def body_usda_calendar(c):
    """The one visible line under the calendar's heading that answers "next
    wasde report" and "wasde report dates 2026" without JavaScript. The
    countdown card beside it is filled by the page script, so a crawler (and a
    reader whose script failed) saw "NEXT USDA REPORT - - -" and no date.
    Dates come from usda_dates.WASDE_2026, the table the title already uses."""
    import usda_dates
    w = c["next_wasde"]
    year = sorted(usda_dates.WASDE_2026)
    lst = (f"{year[0].year} WASDE dates: " +
           ", ".join(f"{MONTHS[d.month - 1][:3]} {d.day}" for d in year) + ".")
    if not w:
        return f"{lst} Each one is out at {WASDE_TIME}."
    if w < c["today"]:
        raise ValueError(f"next_wasde returned {w}, already in the past")
    day = "today" if w == c["today"] else WEEKDAYS[w.weekday()]
    return (f"<strong>Next WASDE: {day}, {mdY(w)}, at {WASDE_TIME}.</strong> {lst}")


def _cot_side(net):
    return "long" if net >= 0 else "short"


def seo_cot(c):
    d = c["cot"]
    if not d or "corn" in d and not isinstance(d.get("corn"), dict):
        return None
    corn = (d or {}).get("corn")
    if not corn or corn.get("net") is None:
        return None
    net = int(corn["net"])
    # The pipeline's side (fetch_cot.side_of): "flat" when |net| is under
    # flat_oi_pct of open interest -- the same band the page's cards use.
    side = corn.get("side") or _cot_side(net)
    k = abs(net) / 1000.0
    kk = f"{k:,.0f}k" if k >= 10 else f"{k:,.1f}k"
    rpt = d.get("report_date") or ""
    # "October 06, 2026" in the file. The CFTC names each report by this
    # Tuesday as-of date, so "COT Report, Oct 6" is the report's own name.
    try:
        rd = datetime.strptime(rpt, "%B %d, %Y").date()
    except ValueError:
        rd = None
    prev = corn.get("prev")
    move = ""
    if isinstance(prev, (int, float)):
        delta = net - int(prev)
        if delta:
            move = (f" Funds {'added' if (delta > 0) == (net >= 0) else 'cut'} "
                    f"{abs(delta):,} on the week.")
    # RETITLED 2026-10-13 from "Managed Money Is Net Long Corn 330k: CFTC
    # COT". Over Jul 10-Oct 7 that held position 5.9 on 8,591 impressions at
    # 0.19% CTR. The queries Search Console names are a report and a date:
    # "cftc commitment of traders report", "cftc ... cot september 1 2026
    # managed money". The title now leads with the report's name and its
    # as-of date, then the corn position; the description spells out
    # "Commitments of Traders" and names the other markets on the page.
    when = f"{MONTHS[rd.month - 1][:3]} {rd.day}" if rd else ""
    rlong = mdY(rd) if rd else rpt
    if side == "flat":
        head = (f"CFTC Commitments of Traders, {rlong}: managed money near flat in "
                f"corn (net {_cot_side(net)} {abs(net):,} contracts, under "
                f"{d.get('flat_oi_pct', 2.0)}% of open interest).")
        pos = "Managed Money Near Flat in Corn"
    else:
        head = (f"CFTC Commitments of Traders, {rlong}: managed money net {side} "
                f"{abs(net):,} corn contracts.")
        pos = f"Managed Money Net {side.title()} Corn {kk}"
    tail = " Soybeans, wheat, cattle, hogs, milk too."
    desc = head + move + tail
    if len(desc) > DESC_MAX:          # the move clause is the optional one
        desc = head + tail
    if len(desc) > DESC_MAX:
        desc = head
    for cand in ((f"CFTC COT Report, {when}: {pos}" if when else None),
                 (f"COT Report, {when}: {pos}" if when else None),
                 f"CFTC COT Report: {pos}"):
        if cand and len(cand + SUFFIX) <= TITLE_MAX:
            return (cand + SUFFIX, desc)
    return None


def seo_crop_tour(c):
    d = c["crop_tour"]
    if not d or not d.get("tour"):
        return None
    t = d["tour"]
    yr = t.get("year")
    start = date.fromisoformat(t["start"])
    end = date.fromisoformat(t["end"])
    today = c["today"]
    nights = d.get("nights") or []
    posted = [n for n in nights if n.get("posted")]

    if today < start:
        days = (start - today).days
        # WAS: f"starts in {days} days".
        #
        # That form is 69 to 70 characters once the year, the tail and the
        # suffix are on it, TITLE_MAX is 68, and check() refuses an over-long
        # title by skipping the page entirely. So through the whole run-up to
        # the 2026 tour this branch never wrote anything, and crop-tour.html
        # kept a title left over from an earlier bake. That is how a page ends
        # up saying "Night 1 Results" on a day when the builder was trying to
        # say "starts in 5 days": the refusal was correct and silent, and the
        # stale title outlived it.
        #
        # A date is the same answer at a fixed width, and it fits: 66.
        lead = ("starts tomorrow" if days == 1 else
                "starts today" if days == 0 else f"starts {mdY(start)[:-6]}")
        return (f"Pro Farmer Crop Tour {yr} {lead.title()}: Nightly Results{SUFFIX}",
                f"The {yr} Pro Farmer Crop Tour runs {span(start, end)}. "
                f"State numbers here every night, next to USDA's and ours, plus "
                f"how close the tour has actually been.")

    if today <= end or not posted:
        n = len(posted)
        # WAS: f"... Night {max(n,1)} Results ..."
        #
        # The max() was guarding against printing "Night 0". It did stop that.
        # It stopped it by printing a CLAIM instead of a placeholder: on the
        # first day of the 2026 tour, with all four nights still posted:false
        # and every corn and pods value null, this page went out titled
        # "Night 1 Results" and there were no results. Zero posted nights is
        # not an edge case to round away, it is the true state of the page for
        # the whole week before the tour and for the first day of it.
        #
        # Tested on n == 0, because that is the state it shipped wrong in.
        title = (f"Pro Farmer Crop Tour {yr}: Scout Results Nightly{SUFFIX}"
                 if n == 0 else
                 f"Pro Farmer Crop Tour {yr}: Night {n} Results{SUFFIX}")
        return (title,
                f"Pro Farmer Crop Tour {yr} results by state, posted each night "
                f"of {span(start, end)}, next to USDA's number and ours, "
                f"plus the tour's own accuracy record.")

    tour = (d.get("benchmarks") or {}).get("tour") or {}
    if tour.get("corn"):
        # "Results" added 2026-10-11: "pro farmer crop tour results" and
        # "... 2026 results" are among the page's named queries, and after the
        # tour the results are what the page holds.
        return (f"Pro Farmer Crop Tour {yr} Results: Corn {tour['corn']} bu/ac{SUFFIX}",
                f"Pro Farmer's {yr} national corn estimate is {tour['corn']} "
                f"bu/ac. Set against USDA's number and ours, with how close the "
                f"tour has actually been since 2015.")
    return (f"Pro Farmer Crop Tour {yr}: Results & Accuracy Record{SUFFIX}",
            f"Every night of the {yr} Pro Farmer Crop Tour by state, next to "
            f"USDA's number and ours, plus the record nobody publishes: how "
            f"close the tour has actually been.")


def _qs_kind(ia):
    """How the file labels Iowa's number: never call a forecast a final."""
    yr = ia.get("year")
    if ia.get("forecast"):
        m = ia.get("forecast_month")
        return f"USDA {m} {yr} forecast" if m else f"USDA {yr} forecast"
    return f"USDA {yr} final"


def _qs_top(ss, ia, crop, n):
    """The n largest producing states for `crop`, counted only when their
    figure is the same vintage as Iowa's (same year, same forecast status,
    same forecast month), so one line never mixes a final with a forecast."""
    same = lambda v: (v.get("year") == ia.get("year") and
                      bool(v.get("forecast")) == bool(ia.get("forecast")) and
                      v.get("forecast_month") == ia.get("forecast_month"))
    rows = [(v.get(f"{crop}_prod") or 0, v.get("name") or k, v.get(f"{crop}_yield"))
            for k, v in ss.items()
            if isinstance(v, dict) and same(v) and v.get(f"{crop}_yield") is not None]
    rows.sort(key=lambda r: -r[0])
    return [(nm, y) for _, nm, y in rows[:n]]


def seo_quick_stats(c):
    d = c["state_stats"]
    if not d or not d.get("stateStats"):
        return None
    ss = d["stateStats"]
    ia = ss.get("IA") or {}
    y = ia.get("corn_yield")
    if y is None:
        return None
    # RETITLED 2026-10-13 from "Corn & Soybean Yields by State: USDA NASS
    # Data". Over Jul 10-Oct 7 that held position 7.5 on 50,358 impressions at
    # 0.08% CTR, the most-shown and least-clicked page on the site. The
    # queries Search Console names ask for a yield by state ("usda yield by
    # state", "state corn and soybean yields"). The title now names the
    # vintage the numbers are (which month's forecast, or final) and the
    # description leads with the largest states' numbers.
    kind = _qs_kind(ia)
    title = (f"Corn & Soybean Yield by State: "
             f"{kind.replace('forecast', 'Forecast').replace('final', 'Final')}{SUFFIX}")
    if len(title) > TITLE_MAX:
        title = f"Corn & Soybean Yield by State, {ia.get('year')}{SUFFIX}"
    corn = _qs_top(ss, ia, "corn", 3)
    # 2026-10-17: three soybean states, not one. Search Console, Jul 15 to Oct 14:
    # "average soybean yield per acre by state" drew 406 impressions at position
    # 8.7 and no clicks while the snippet named a single soybean state. The three
    # largest growers go in when they fit; fewer when they do not.
    beans3 = _qs_top(ss, ia, "bean", 3)
    lead = ", ".join(f"{nm} {v:g}" if i else f"{nm} corn {v:g} bu/ac"
                     for i, (nm, v) in enumerate(corn)) or f"Iowa corn {y:g} bu/ac"
    for nb in range(len(beans3), -1, -1):
        beans = beans3[:nb]
        bl = (f"; {beans[0][0]} soybeans {beans[0][1]:g}" + "".join(f", {nm} {v:g}" for nm, v in beans[1:])) if beans else ""
        head = f"{kind}: {lead}{bl}."
        # 2026-10-18: name the years the page holds and the CSV (Search
        # Console: "quick stats corn by state 2019 2020 2021", 1,343
        # impressions at 6.9, no clicks, while the snippet showed one year).
        # The range is the finals series the CSV downloads, read from the
        # data files, never typed.
        yr = c.get("nass_years")
        csv = ((f" Every state, {yr[0]} to {yr[1]} finals as CSV.", f" {yr[0]} to {yr[1]} finals, CSV download.")
               if yr else ())
        for tail in csv + (" Every state, yields since 2010, from NASS Quick Stats.",
                           " Every state, from NASS Quick Stats."):
            if len(head + tail) <= DESC_MAX:
                return title, head + tail
    head = f"{kind}: {lead}."
    if len(head) <= DESC_MAX:
        return title, head
    return title, f"{kind}: Iowa corn {y:g} bu/ac. Every state, from NASS Quick Stats."


def body_quick_stats(c):
    """One visible line under the heading with the largest states' yields.
    The top-states list lower down is drawn by the page script; this is the
    same file (data/state-stats.json) as text a crawler can read."""
    d = c["state_stats"]
    ss = (d or {}).get("stateStats") or {}
    ia = ss.get("IA") or {}
    if ia.get("corn_yield") is None:
        raise ValueError("no Iowa corn yield in state-stats.json")
    kind = _qs_kind(ia)
    corn = _qs_top(ss, ia, "corn", 5)
    beans = _qs_top(ss, ia, "bean", 5)
    out = (f"<strong>Yield by state, {kind}:</strong> corn " +
           ", ".join(f"{nm} {v:g}" for nm, v in corn) + " bu/ac")
    if beans:
        out += "; soybeans " + ", ".join(f"{nm} {v:g}" for nm, v in beans) + " bu/ac"
    return out + "."


def seo_cond_yield(c):
    """"2026 crop size: every forecast", described from data/yield-panel.json.

    RETITLED 2026-10-10. The page used to be "Do Crop Ratings Predict Yield?
    The Real R²"; it now leads with every published 2026 yield forecast side by
    side, and the R² research sits in a folded section. The description names
    each corn forecast with its date, read off the panel file the page itself
    renders, so the snippet cannot quote a number the page no longer shows.
    This is the ONE writer of this page's description (build_condyield.py
    stopped writing it on the same day)."""
    d = c.get("yield_panel")
    rows = ((((d or {}).get("crops") or {}).get("corn") or {}).get("rows")) or []
    if not rows:
        return None
    short = {"usda": "USDA", "profarmer": "Pro Farmer tour", "dtn": "DTN", "agsist": "our ratings model"}
    bits = []
    for r in sorted(rows, key=lambda r: (r.get("id") != "usda", r.get("value") or 0)):
        if r.get("value") is None:
            continue
        name = short.get(r.get("id")) or r.get("name") or ""
        when = ""
        try:
            when = f" ({date.fromisoformat(str(r['as_of'])[:10]).strftime('%b %-d')})" if r.get("id") == "usda" else ""
        except (KeyError, ValueError):
            when = ""
        bits.append(f"{name} {float(r['value']):.1f}{when}")
    desc = "Every 2026 US corn yield forecast side by side: " + ", ".join(bits) + ". Soybeans too."
    if len(desc) > DESC_MAX:
        desc = "Every 2026 US corn yield forecast side by side: " + ", ".join(bits[:3]) + ". Soybeans too."
    return ("2026 crop size: every forecast" + SUFFIX, desc)


def seo_conditions(c):
    """Today's national G+E against the same week last year. Both from the file."""
    d = c.get("crop_progress")
    if not d or not d.get("in_season"):
        return None
    corn = d.get("corn") or {}
    ge, prev = corn.get("good_excellent"), corn.get("good_excellent_prev_year")
    if ge is None:
        return None
    soy = (d.get("soybeans") or {}).get("good_excellent")
    # Built clause by clause: with no prior-year figure the old f-string left
    # "soybeans 57%,." in the live meta description.
    lead = f"US corn is {ge:g}% good to excellent"
    if prev is not None:
        lead += f" against {prev:g}% a year ago"
    if soy is not None:
        lead += f"; soybeans {soy:g}%"
    # Night audit, Oct 19, 2026: "crop progress usda" and "crop progress report" land here and
    # the title said Conditions only. NASS dates the report by the week ENDING on its Sunday
    # (the page says "week ending Oct 11, 2026"), so never "Week of".
    wk = ""
    rd = d.get("report_date") or corn.get("report_date")
    try:
        _rd = date.fromisoformat(str(rd)[:10])
        wk = f"{_rd:%b} {_rd.day}"
    except ValueError:
        pass
    # Harvest season (panel Oct 20, seat B): October searches ask how far harvest is, so
    # the title leads with the harvest percent when this week's report carries one. Each
    # crop's figure counts only when it is dated within a week of the report and is
    # between 0 and 100 (a finished harvest, or none started, keeps the plain title).
    cands = []
    hv = []
    for key, nm in (("corn", "Corn"), ("soybeans", "Soybeans")):
        x = d.get(key) or {}
        hp, hd = x.get("harvest_pct"), x.get("harvest_date")
        try:
            fresh = bool(wk) and abs((date.fromisoformat(str(hd)[:10]) - _rd).days) <= 6
        except (TypeError, ValueError):
            fresh = False
        if isinstance(hp, (int, float)) and 0 < hp < 100 and fresh:
            hv.append((nm, hp, x.get("harvest_5yr_avg")))
    if hv and hv[0][0] == "Corn":
        h0 = f"Corn {hv[0][1]:g}% Harvested"
        h1 = h0 + (f", Soybeans {hv[1][1]:g}%" if len(hv) > 1 else "")
        # " | AGSIST" gives way before "Week Ending" does (seo_caps)
        cands += [f"{h1}: Crop Progress, Week Ending {wk}{SUFFIX}", f"{h1}: Crop Progress, Week Ending {wk}",
                  f"{h0}: Crop Progress, Week Ending {wk}{SUFFIX}", f"{h0}: Crop Progress, Week Ending {wk}"]
        avg = hv[0][2]
        hl = (f"US corn is {hv[0][1]:g}% harvested" + (f" against a {avg:g}% five-year average" if isinstance(avg, (int, float)) else "")
              + (f", soybeans {hv[1][1]:g}%" if len(hv) > 1 else ""))
        # soybean ratings stop before corn's (the Oct 18 file still holds the Oct 11 soybean 57%):
        # only a rating from this week's report is printed beside it
        srd = str((d.get("soybeans") or {}).get("report_date") or rd or "")[:10]
        gl = f"Corn is {ge:g}% good to excellent" + (f", soybeans {soy:g}%" if soy is not None and srd == str(rd)[:10] else "")
        # the page also carries every yield forecast for the year (#crop-size, merged Oct 22, 2026)
        yr = f"{_rd.year} " if wk else ""
        desc_h = next((x for x in (f"{hl}. {gl}. State ranks and every {yr}yield forecast.",
                                   f"{hl}. {gl}. Every state ranked against its own record.", f"{hl}. {gl}.", f"{hl}.")
                       if len(x) <= DESC_MAX), f"{hl}.")
        title = next((t for t in cands if len(t) <= TITLE_MAX), None)
        if title and len(desc_h) <= DESC_MAX:
            return (title, desc_h)
        cands = []
    if wk:
        cands.append(f"Crop Progress, Week Ending {wk}: Corn {ge:g}% Good-Excellent{SUFFIX}")
    cands.append(f"USDA Crop Conditions: Corn {ge:g}% Good-Excellent{SUFFIX}")
    title = next(t for t in cands if len(t) <= TITLE_MAX)
    return (title,
            next(x for x in (f"{lead}. Every state ranked against its own record, and every yield forecast.",
                             f"{lead}. Every state's rating ranked against its own record for this week.")
                 if len(x) <= DESC_MAX or x.endswith("this week.")))


def _px(prices, key):
    q = ((prices or {}).get("quotes") or {}).get(key) or (prices or {}).get(key)
    if isinstance(q, dict):
        for f in ("last", "close", "price", "px"):
            if isinstance(q.get(f), (int, float)):
                return float(q[f])
    return None


BE_COST_KEYS = ("seed", "fertilizer", "chemicals", "insurance", "machinery",
                "labor", "land", "overhead")


def _be_defaults(crop, page_text=None):
    """(cost per acre, yield) from breakeven.html's own CROP_DEFAULTS, the
    numbers the calculator opens with. Read from the page so the example in
    the snippet is always the one the calculator shows."""
    t = page_text if page_text is not None else (REPO / "breakeven.html").read_text(encoding="utf-8")
    m = re.search(r"\b" + crop + r":\{([^}]*)\}", t[t.find("CROP_DEFAULTS"):])
    if not m:
        return None
    kv = dict(re.findall(r"(\w+):'?([\d.]*)'?", m.group(1)))
    try:
        cost = sum(float(kv[k]) for k in BE_COST_KEYS)
        yld = float(kv["yield"])
    except (KeyError, ValueError):
        return None
    if cost <= 0 or yld <= 0:
        return None
    return cost, yld


def _be_budget_year(page_text=None):
    """The crop year of the cost lines the calculator opens with (breakeven.html BUDGETS.year)."""
    t = page_text if page_text is not None else (REPO / "breakeven.html").read_text(encoding="utf-8")
    m = re.search(r"var BUDGETS=\{year:(\d{4}),", t)
    return int(m.group(1)) if m else None


def seo_breakeven(c):
    # 2026-10-17: the costs are farmdoc's 2027 budget, so the board quoted beside them is
    # Dec '27 (the calculator opens on it too), not the 2026 crop's Dec '26.
    by = _be_budget_year()
    key, mon = ("corn-dec%02d" % (by % 100), "Dec '%02d " % (by % 100)) if by else ("corn", "")
    px = _px(c["prices"], key)
    if px is None and key != "corn":
        key, mon = "corn", ""
        px = _px(c["prices"], key)
    if px is None:
        return None
    cents = px if px > 50 else px * 100.0      # cents vs dollars
    # RETITLED 2026-10-13 from "Break-Even Price Calculator: Corn, Soybeans,
    # Wheat" (2,679 impressions, 12 clicks, Jul 10-Oct 7). The named queries
    # ask for a number: "break even price for corn" 35 impressions, "corn
    # break even price" 10. The description now gives the calculator's own
    # opening example, labeled as an example, beside the board.
    title = f"Corn & Soybean Break-Even Price per Bushel Calculator{SUFFIX}"
    d = _be_defaults("corn")
    if d:
        cost, yld = d
        desc = (f"Example: ${cost:,.0f} an acre at {yld:g} bu/ac is a ${cost / yld:.2f} corn "
                f"break-even; {mon}futures are near {pricefmt.price(cents)}. Put in your own costs "
                f"for corn, soybeans or wheat.")
        if len(desc) <= DESC_MAX:
            return title, desc
    return (title,
            f"Corn is near {pricefmt.price(cents)}. Enter your cost per acre and your yield "
            f"to get your break-even price per bushel, and the yield where the "
            f"board stops covering them.")


def body_breakeven(c):
    """The calculator's opening example as a line a reader sees before
    touching an input, and a crawler sees at all (the results panel is
    drawn by the page script)."""
    bits = []
    for crop, name in (("corn", "corn"), ("soybeans", "soybeans")):
        d = _be_defaults(crop)
        if not d:
            # 2026-10-15: the fertilizer default is baked from live posted
            # prices (scripts/bake_fert_defaults.py) and is empty when there
            # is no live price. Then there is no example: a line with no
            # number, never the last one left standing.
            return ("<strong>Put in your own costs below</strong> to get your break-even price per bushel. "
                    "The fertilizer default is empty because no live fertilizer price is posted right now.")
        cost, yld = d
        bits.append((name, cost, yld))
    (n1, c1, y1), (n2, c2, y2) = bits
    # 2026-10-17: the corn and soybean defaults are farmdoc's 2027 northern
    # Illinois budget lines (breakeven.html BUDGETS), so the example says so.
    return (f"<strong>Example with this page's default costs</strong> (farmdoc's 2027 northern Illinois budget, "
            f"fertilizer at posted co-op prices): {n1} at "
            f"${c1:,.0f} an acre and {y1:g} bu/ac breaks even at ${c1 / y1:.2f} a bushel; "
            f"{n2} at ${c2:,.0f} and {y2:g} bu/ac at ${c2 / y2:.2f}. "
            f"Change any line below to get yours.")


def _be_corn():
    d = _be_defaults("corn")
    return (d[0], d[1], d[0] / d[1]) if d else None


def body_be_faq(c):
    """The sentence under the calculator that quotes the corn defaults. It was
    typed ($905 / $5.03) and went stale when the fertilizer default became a
    baked live price ($910 / $5.06, 2026-10-16 audit); it is baked from the
    same CROP_DEFAULTS now, or says no number when there is none."""
    d = _be_corn()
    if not d:
        return "With no live fertilizer price there is no default example right now; put in your own costs."
    cost, yld, be = d
    return (f"With the default example costs (${cost:,.0f}/acre, {yld:g} bu corn), the break-even works out "
            f"to about ${be:.2f} per bushel cash.")


def body_be_total(c):
    """The results panel before the script runs (crawlers, no script)."""
    d = _be_corn()
    return f"${d[0]:,.0f}/ac" if d else "-"


def body_be_cpb(c):
    d = _be_corn()
    return f"${d[2]:.2f}/bu" if d else "-"


# ---------------------------------------------------------------- futures
# The biggest ranking gap in the 2026-08-16 export is one query cluster:
#
#     "cbot *"   3,205 impressions   1 click   average position 19.7
#
# 120 queries, one click between all of them. And the pattern inside the
# cluster is hard to unsee: the two pages whose TITLE carries the exchange
# name rank best, the two that do not rank worst.
#
#     corn    title says CBOT       corn queries      position 16.2
#     beans   title says CBOT       soybean queries   position 21.8
#     wheat   title says NOTHING    wheat queries     position 33.4, 0 clicks
#     cattle  title says NOTHING    cattle queries    position 28.6, 0 clicks
#
# Both silent pages carry the exchange 26 and 12 times in the body, so this is
# not a coverage problem, it is a title problem. Correlation across four pages
# is not proof, but putting the exact term somebody searched into the title is
# the cheapest thing on the list and the only one that costs nothing if wrong.
#
# These four take TITLE ONLY. seed_static.py already owns their meta
# description and rewrites it with the day's close every trading day; two
# writers on one field is how you get numbers that disagree in public.

# Corn and soybeans changed 2026-10-11 from "CBOT Corn Futures: Dec '26
# $4.80, Live Prices" to "CBOT Corn Futures Price: Dec '26 $4.80". Over Jul
# 10-Oct 7 the named queries ask for a PRICE: corn "chicago board of trade corn
# price today" 181 impressions, "chicago board of trade corn price" 153; beans
# "cbot soybean price" 31 beside "cbot soybeans" 2,248 at position 11. The
# trailing "Live Prices" said nothing the number did not. extra=None means no
# tail. Wheat took "Futures Price" too on 2026-10-13 (7,348 impressions, 4
# clicks, position 14.2 over the same window).
FUTURES = {
    "corn-futures-prices.html":
        ("CBOT", "Corn", "corn", None),
    "soybean-futures-prices.html":
        ("CBOT", "Soybean", "beans", None),
    "wheat-futures-prices.html":
        ("CBOT", "Wheat", "wheat", "SRW & KC HRW"),
}

# Cattle is its own case twice over. seed_static.py does NOT write a
# description for it -- its DESC dict is the three grain pages only -- so this
# page owns both fields. And it quotes two different animals: a single number
# in the title would be read as whichever one the searcher came for. The
# biggest keyword in the whole Bing export is "feeder cattle futures", 3,665
# impressions at position 6.5, so that phrase goes in whole and both prices are
# named.
CATTLE_PAGE = "cattle-futures-prices.html"


def seo_cattle(c):
    """Both animals at their newest FINISHED session (seed_static.settled_close,
    the same rule the grain descriptions use). In session that is the previous
    close; a trade that will move by noon is never baked into a snippet."""
    from seed_static import settled_close
    p = c["prices"] or {}
    fetched = p.get("fetched", "")
    live = settled_close(_quote(p, "cattle"), fetched, "cattle")
    feed = settled_close(_quote(p, "feeders"), fetched, "cattle")
    if live is None or feed is None or live["date"] != feed["date"]:
        return None
    lab = _label(p, "cattle")
    when = f" {lab}" if lab else ""
    # livestock to the tick, the site's one rule (pricefmt.cash): $343.625, $227.55
    fp, lp = pricefmt.cash(feed["px"]), pricefmt.cash(live["px"])
    # The settle's own date rides in the title (2026-10-20 panel A4/B1/E2: on
    # a weekday evening the title holds the session before, and an undated
    # number read as today's). " | AGSIST" gives way first.
    head = f"CME Feeder Cattle Futures {fp} & Live Cattle {lp} ({feed['label']})"
    return (fit([head + SUFFIX, head]),
            f"Feeder cattle settled {fp}, live cattle{when} "
            f"{lp} on {feed['label']}. CME futures every 15 min, "
            "with 5-year ranges, the feeder-to-live ratio and cost of gain.")


def _quote(prices, key):
    """The same contract seed_static.py seeds into the page body.

    CAUGHT IN TESTING, 2026-08-16: the bare key is a CONTINUOUS series. On this
    day quotes["beans"] was ZS=F repaired from beans-sep26 at 1176.25, while
    nearby["beans"] pointed at beans-aug26 at 1167.0. Reading the bare key and
    printing the nearby LABEL would have published

        CBOT Soybean Futures: Aug '26 $11.76

    -- September's price under August's name, in the title, on a page whose
    body said $11.67 three lines down. Corn and wheat happened to agree that
    day, so only soybeans exposed it.

    seed_static.py v1.4 already settled this: prefer <crop>-nearby, the true
    nearest dated contract. One rule per fact; this is that rule, not a second
    copy of it."""
    q = (prices or {}).get("quotes") or {}
    return q.get(f"{key}-nearby") or q.get(key) or {}


def _close(prices, key):
    q = _quote(prices, key)
    for f in ("close", "last", "price"):
        v = q.get(f)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _label(prices, key):
    n = ((prices or {}).get("nearby") or {}).get(key) or {}
    return n.get("label")


def _known_trade(q):
    """True when the quote is known to be a trade with no settle to bake: a
    fetch_prices v3.7 quote with no settle field, or a v3.6 quote whose
    previous close was the afternoon's last trade. The page then gets a title
    with no number rather than keeping one that a last trade wrote
    (2026-10-17: "closed $12.60 1/2" against a $12.61 1/4 settle)."""
    q = q or {}
    return q.get("close_kind") is not None or q.get("prev_source") == "recorded settle"


# 2026-10-18: "CBOT" leads. Search Console, Jul to Oct 14: "cbot live" 281
# impressions at 9.2 and "c bot live" 99 at 7.0, no clicks, while the title
# was a date line ("Ag Markets Oct 16") with no CBOT in it. The description
# says delayed or settle, never "live": quotes are 15 minutes behind.
MARKETS_PLAIN = ("CBOT Grain Prices Today: Corn, Soybeans, Wheat" + SUFFIX,
                 "Corn, soybean, wheat, cattle and crude futures on one board, 15-minute delayed "
                 "in session, with settles, cash bids and USDA dates. Free.")


def make_futures(page):
    exch, crop, key, extra = FUTURES[page]

    def build(c):
        # the newest finished session, never an in-session trade (2026-10-15:
        # the Oct 14 8:31 a.m. soybean quote sat in the title overnight)
        from seed_static import settled_close
        p = c["prices"] or {}
        sc = settled_close(_quote(p, key), p.get("fetched", ""),
                           "cattle" if key == "cattle" else "grain")
        lab = _label(p, key)
        if sc is None and _known_trade(_quote(p, key)):
            return (f"{exch} {crop} Futures Price Today"
                    + (f", {extra}" if extra else "") + SUFFIX, None)
        if sc is None or not lab:
            return None
        px = sc["px"]
        # grain boards quote in cents; cattle already quotes in dollars per cwt
        money = pricefmt.price(px) if key != "cattle" else pricefmt.cash(px)
        # Dated by the settle itself (2026-10-20, panel A4/B1/E2): from the
        # 1:20 p.m. CT close until Yahoo posts the settle near 11 p.m. CT the
        # newest settle is the session before, and an undated "$4.74 1/4"
        # read as today's price beside a page showing $4.66 3/4.
        base = f"{exch} {crop} Futures Price: {lab} {money} ({sc['label']})"
        cands = ([base + f", {extra}" + SUFFIX, base + f", {extra}"] if extra else []) + [base + SUFFIX, base]
        return (fit(cands), None)

    build.__name__ = f"seo_{key}_futures"
    return build


# ---------------------------------------------------------------- data pages
# Added 2026-10-06 with the seed_static.py v1.5 body seeds. Same rails as
# everything above, plus one more: a STALENESS limit per file. The no-data rule
# keeps a page from being titled with a blank; it does not stop a page being
# titled with last month's number when the fetcher quietly stops. A file older
# than its limit is "no data" here, and the page keeps what it has.

def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:                                     # noqa: BLE001
        return None


def _too_old(d, today, days):
    return d is None or (today - d).days > days or d > today


def _usd(v):
    return f"${v:,.2f}"


def seo_markets(c):
    """The board, dated by the corn quote's own close date -- never the run
    date. A quote whose close is from another day is left out rather than
    printed beside a date it does not belong to (livestock and the S&P close
    a session apart from grains on a Monday)."""
    p = c.get("prices")
    if not p:
        return None
    # 2026-10-15: finished sessions only (seed_static.settled_close). The
    # Oct 14 8:31 a.m. CT trade was baked as "Ag Markets Oct 14: Corn $4.81¼"
    # and stood after the close went the other way.
    from seed_static import settled_close
    fetched = p.get("fetched", "")
    corn = settled_close(_quote(p, "corn"), fetched, "grain")
    if corn is None:
        return MARKETS_PLAIN if _known_trade(_quote(p, "corn")) else None
    cd = _d(corn["date"])
    if _too_old(cd, c["today"], 4) or _too_old(_d(fetched), c["today"], 4):
        return None
    picks = []
    for key, name, grain in (("corn", "Corn", True), ("beans", "Soybeans", True),
                             ("wheat", "Wheat", True), ("cattle", "Live Cattle", False),
                             ("crude", "Crude", False)):
        q = _quote(p, key)
        sc = settled_close(q, fetched, "cattle" if key == "cattle" else "grain")
        if sc is None or _d(sc["date"]) != cd:
            continue
        v = sc["px"]
        picks.append((key, name, pricefmt.price(v) if grain else _usd(v), q.get("contract")))
    grains = [x for x in picks if x[0] in ("corn", "beans", "wheat")]
    if not grains or grains[0][0] != "corn":
        return None
    day = f"{MONTHS[cd.month - 1][:3]} {cd.day}"
    title = None
    for n in (3, 2, 1):
        cand = (f"CBOT Grain Prices {day}: " + ", ".join(f"{nm} {px}" for _, nm, px, _ in grains[:n]) + SUFFIX)
        if len(cand) <= TITLE_MAX:
            title = cand
            break
    if not title:
        return None
    head = (f"Settles {mdY(cd)}: " +
            ", ".join(f"{nm.lower() if i else nm}{(' ' + ct) if ct else ''} {px}"
                      for i, (_, nm, px, ct) in enumerate(picks)) + ".")
    tail = " Quotes 15-min delayed, free."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    while len(desc) > DESC_MAX and len(picks) > 1:   # shed the least-searched quote
        picks = picks[:-1]
        desc = (f"Settles {mdY(cd)}: " +
                ", ".join(f"{nm.lower() if i else nm}{(' ' + ct) if ct else ''} {px}"
                          for i, (_, nm, px, ct) in enumerate(picks)) + ".")
    return title, desc


def _basis_rows(j, crop):
    """(table week, rows posted that week with a normal, newest week posted).
    ONE WEEK PER TABLE, as the page prints it (2026-10-10): the week
    scripts/fetch_transport.py wrote for the crop in `weeks` (a week back when
    the newest one is held as a jump), else the newest posting. A region not
    posted that week is not counted."""
    ser = (j or {}).get("series") or {}
    newest = max((_d(s.get("date")) for s in ser.values() if _d(s.get("date"))), default=None)
    wk = _d((((j or {}).get("weeks") or {}).get(f"{crop}|Elevator Bid") or {}).get("week")) or newest
    rows = []
    for k, s in ser.items():
        parts = k.split("|")
        if len(parts) != 3 or parts[0] != crop or parts[2] != "Elevator Bid":
            continue
        if wk and _d(s.get("date")) == wk and s.get("delta") is not None:
            rows.append((parts[1], s))
    return wk, sorted(rows, key=lambda r: r[1]["delta"]), newest


def seo_basis(c):
    """Regional corn basis against its own 5-year same-week normal, counted
    with the page's own bands (more than 10 cents either way), in the week the
    page's table shows. The title follows the larger side, says "mixed" on a
    tie, and never calls a split week weak. Dated by the USDA week in the
    description, with the held week named when there is one."""
    j = c.get("basis")
    wk, rows, newest = _basis_rows(j, "Corn")
    if not rows or _too_old(wk, c["today"], 21):
        return None
    under = sum(1 for _, s in rows if s["delta"] < -0.1)
    over = sum(1 for _, s in rows if s["delta"] > 0.1)
    n = len(rows)
    if under > over:
        title = f"Corn Basis vs Normal: Weak in {under} of {n} USDA Regions{SUFFIX}"
    elif over > under:
        title = f"Corn Basis vs Normal: Strong in {over} of {n} USDA Regions{SUFFIX}"
    elif under:
        title = f"Corn Basis vs Normal: Mixed Across {n} USDA Regions{SUFFIX}"
    else:
        title = f"Corn Basis vs Normal: All {n} USDA Regions Near Normal{SUFFIX}"
    name, w = rows[0]
    sign = lambda v: ("-" if v < 0 else "+") + f"${abs(v):.2f}"      # noqa: E731
    head = (f"Week of {mdY(wk)}: corn basis over 10¢ under its 5-year normal in {under} of {n} regions, "
            f"over 10¢ above in {over}.")
    held = len(((((j or {}).get("weeks") or {}).get("Corn|Elevator Bid") or {}).get("held")) or [])
    tails = ([f" USDA's {newest.strftime('%b')} {newest.day} week is held."] if held and newest and newest != wk else []) + \
        [f" Weakest: {name} {sign(w['latest'])} vs {sign(w['avg5'])}.", " Barge rates that move it."]
    desc = head
    for t in tails:
        if len(desc + t) <= DESC_MAX:
            desc += t
    return title, desc


FERT_TITLE_ORDER = (("urea", "Urea"), ("anhydrous", "Anhydrous"), ("dap", "DAP"), ("potash", "Potash"))
FERT_ROUND_DAYS = 30
FERT_TITLE_DAYS = 30    # a newest price older than this: no number in the title (was 120 until 2026-10-16)
FERT_PLAIN = ("Fertilizer Prices per Ton: What Co-ops Are Posting" + SUFFIX,
              "Retail fertilizer prices co-ops post on their own websites, each named with its region "
              "and date. Cost per lb of N, P and K.")


def seo_fertilizer(c):
    """data/fertilizer-prices.json (scripts/build_fert_prices.py): each
    product's middle cash price posted by the co-ops Sig sent, nothing else. Posted prices move week to week, so the TITLE carries no date --
    a date there would read as today's price. The dates the named prices were
    posted go in the description, and a price more than FERT_ROUND_DAYS older
    than the newest is not named. Until 2026-10-15 this read a hand-typed
    dealer sheet.

    2026-10-16 (harvest audit): the title says whose prices they are ("Kansas
    Co-op Fertilizer per Ton: ..."), because a Wisconsin farmer pricing fall
    anhydrous read a bare "Urea $623" as his own; the description gives the
    posting dates of the named prices (it said "through Oct 12" when only MAP,
    not in the title, was that new); and a newest price over FERT_TITLE_DAYS
    old drops the number from the title.

    With no file, no dated price, or a newest price over FERT_TITLE_DAYS old,
    it returns FERT_PLAIN: a title and description with no number."""
    d = c.get("fertilizer")
    rows = (d or {}).get("prices") or []
    dated = [(r, _d(r.get("as_of"))) for r in rows if isinstance(r.get("price"), (int, float)) and r.get("key")]
    dated = [(r, a) for r, a in dated if a]
    if not dated:
        return FERT_PLAIN
    newest = max(a for _, a in dated)
    if _too_old(newest, c["today"], FERT_TITLE_DAYS):
        return FERT_PLAIN
    cur = {r["key"]: (r, a) for r, a in dated if (newest - a).days <= FERT_ROUND_DAYS}
    named = [(short, cur[k][0], cur[k][1]) for k, short in FERT_TITLE_ORDER if k in cur]
    if not named:
        return FERT_PLAIN
    # a row's region may already name two states ("Kansas and Wisconsin"):
    # split it so the states are each named once
    def regions(r):
        if r.get("src") != "coop" or not r.get("region"):
            return frozenset()
        return frozenset(x for x in re.split(r", (?:and )?| and ", r["region"]) if x)

    def and_join(xs):
        xs = sorted(xs)
        return ", ".join(xs[:-1]) + " and " + xs[-1] if len(xs) > 2 else " and ".join(xs)

    def who_of(rs):
        # the states of the prices this title names, not of every product
        regs_n = set().union(*[regions(r) for r in rs])
        return (and_join(regs_n) + " Co-op") if regs_n else "Co-op"

    title = None
    for n in range(len(named), 0, -1):
        who = who_of([r for _, r, _ in named[:n]])
        bits = ", ".join(f"{s} ${r['price']:,.0f}" for s, r, _ in named[:n])
        # "per Ton" stays (2026-10-13): the page's named queries are
        # "... fertilizer price(s) per ton". Down to one number, the word
        # "Prices" outranks the number (night SEO audit, Oct 19, 2026): once
        # Wisconsin joined the region the Prices form ran long and the title fell
        # to "Fertilizer per Ton: Urea $616", losing the main query word by accident.
        forms = [f"{who} Fertilizer Prices per Ton: {bits}{SUFFIX}"]
        if n == 1:
            forms.append(f"{who_of([r for _, r, _ in named])} Fertilizer Prices per Ton{SUFFIX}")
        forms.append(f"{who} Fertilizer per Ton: {bits}{SUFFIX}")
        for cand in forms:
            if len(cand) <= TITLE_MAX:
                title = cand
                break
        if title:
            break
    if not title:
        return None
    # 2026-10-17 audit (N7): "Kansas and Wisconsin co-op cash prices ...:
    # anhydrous $832, DAP $936, potash $470" put Wisconsin on three Kansas-only
    # prices. The lead names the states every named price shares; a price
    # that also takes in another state says so after it.
    sets = [x for x in (regions(r) for _, r, _ in named) if x]
    base = frozenset.intersection(*sets) if sets else frozenset()
    parts = []
    for i, (s, r, _) in enumerate(named):
        bit = f"{s if s.isupper() else s.lower()} ${r['price']:,.0f}" + ("/ton" if i == 0 else "")
        if regions(r) and regions(r) != base:
            bit += f" ({and_join(regions(r))})"
        parts.append(bit)
    regs = [and_join(base)] if base else []
    # lo is the oldest sheet inside any named middle (2026-10-16: "posted Oct 6"
    # was printed for a middle that took in Sep 24 sheets)
    lo = min(min(a, _d(r.get("oldest")) or a) for _, r, a in named)
    hi = max(a for *_, a in named)
    if lo == hi:
        when = f"posted {mdY(hi)}"
    elif lo.year == hi.year:
        when = f"posted {mdY(lo).rsplit(',', 1)[0]} to {mdY(hi)}"
    else:
        when = f"posted {mdY(lo)} to {mdY(hi)}"
    lead = (f"{' and '.join(regs)} co-op cash prices {when}: " if regs else f"Fertilizer prices {when}: ")
    head = lead + ", ".join(parts) + "."
    tail = " Cost per lb of N, P and K."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    if len(desc) > DESC_MAX:
        desc = lead + ", ".join(parts[:2]) + "."
    return title, desc


FERT_BAR_WAIT = "Loading co-op prices&hellip;"


def body_fertilizer(c):
    """The line under the fertilizer page's lede (#fert-coop-bar), Sig Oct 19:
    the named co-op prices and their posting dates, so a crawler and a reader
    whose script has not run see prices, not "Loading co-op prices". It is the
    description's own sentence (seo_fertilizer, same run, same file), so the
    body and the snippet carry the same numbers and dates written the same way
    ("$832/ton", then "$623"). The page script draws the co-op cards over it
    on load. No dated price: the old loading words, no number."""
    got = seo_fertilizer(c)
    if not got or got == FERT_PLAIN:
        return FERT_BAR_WAIT
    desc = got[1]
    tail = " Cost per lb of N, P and K."
    return esc(desc[:-len(tail)] if desc.endswith(tail) else desc)


# Added 2026-10-13. /milk-prices was titled as a tool ("Class III & IV Milk
# Prices and Your Milk Check, Explained") while the searcher wants the month's
# number. The body figures are baked from the same file by seed_static.py
# (seed_milk) in the same runs, so the title and the strip cannot disagree.
# The month is the class month the file names, never the run date. Once the
# next month's announcement is due and the file does not have it (7 CFR
# 1000.53: on or before the 5th), the page goes back to the descriptive title
# rather than keep a stale number in the result.
MILK_PAGE = "milk-prices.html"
MILK_TITLE = "Class III & IV Milk Prices and Your Milk Check, Explained" + SUFFIX
MILK_DESC = ("USDA announced Class III and Class IV milk prices, the all-milk price and the DMC "
             "margin, plus the federal order formula that builds your milk check. No login.")


def milk_month(d, today):
    """(month index, label) of the class prices in the dairy file when they are
    still the newest that must exist, else None."""
    import re as _re
    m = _re.match(r"^(\d{4})-(\d{2})$", str((d or {}).get("class_month_key") or ""))
    if not m or not 1 <= int(m.group(2)) <= 12:
        return None
    idx = int(m.group(1)) * 12 + int(m.group(2)) - 1
    now = today.year * 12 + today.month - 1
    due = now - (1 if today.day > 5 else 2)
    if idx < due or idx > now:
        return None
    return idx, f"{MONTHS[idx % 12]} {idx // 12}"


def seo_milk(c):
    from seed_static import _fixed
    d = c.get("dairy")
    if not d:
        return None
    c3, c4 = d.get("class3"), d.get("class4")
    ok = all(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in (c3, c4))
    mm = milk_month(d, c["today"]) if ok else None
    if not mm:
        return MILK_TITLE, MILK_DESC
    idx, label = mm
    title = f"USDA Class III Milk Price {label}: ${_fixed(c3, 2)}{SUFFIX}"
    p3 = d.get("class3_prev")
    chg = ""
    if isinstance(p3, (int, float)) and not isinstance(p3, bool) and p3 > 0:
        x = float(_fixed(c3 - p3, 2))
        chg = (f", {'up' if x > 0 else 'down'} ${_fixed(abs(x), 2)} from {MONTHS[(idx + 11) % 12]}"
               if x else f", unchanged from {MONTHS[(idx + 11) % 12]}")
    head = f"USDA announced {label} Class III at ${_fixed(c3, 2)}/cwt{chg}, Class IV ${_fixed(c4, 2)}."
    tail = " All-milk by state and the formula behind your milk check."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    return title, desc


PAGES = {
    "usda-calendar.html":    (seo_usda_calendar, frozenset({"title", "desc"})),
    "cot.html":              (seo_cot,           frozenset({"title", "desc"})),
    "crop-tour.html":        (seo_crop_tour,     frozenset({"title", "desc"})),
    "usda-quick-stats.html": (seo_quick_stats,   frozenset({"title", "desc"})),
    "breakeven.html":        (seo_breakeven,     frozenset({"title", "desc"})),
    # Added 2026-09-13. Both pages carried a HAND-TYPED number in their search
    # snippet: conditions-yield quoted an R-squared that had already drifted
    # from the file it describes, conditions quoted nothing current at all.
    # Oct 22, 2026: /conditions-yield merged into /conditions (#crop-size) and is a
    # forward page now; seo_cond_yield stays for its selftest and is not baked.
    "conditions.html":       (seo_conditions,    frozenset({"title", "desc"})),
    # Added 2026-10-06. markets and fertilizer keep their descriptive
    # og:image:alt. Since 2026-10-15 no page here owns its alt: the share
    # image is drawn from the page's data (build_share_images.py) and that
    # script writes an alt describing the image, so the two cannot disagree.
    "markets.html":          (seo_markets,       frozenset({"title", "desc"})),
    "basis.html":            (seo_basis,         frozenset({"title", "desc"})),
    "fertilizer.html":       (seo_fertilizer,    frozenset({"title", "desc"})),
    MILK_PAGE:               (seo_milk,          frozenset({"title", "desc"})),
}
for _p in FUTURES:
    PAGES[_p] = (make_futures(_p), frozenset({"title"}))
PAGES[CATTLE_PAGE] = (seo_cattle, frozenset({"title", "desc"}))

# Visible lines baked into the page body, between <!--BAKE:name--> and
# <!--/BAKE-->. Same data, same run and same rails as the head tags above, so
# the line a reader sees and the snippet Google shows cannot disagree.
# The futures H1s say what people type (2026-10-17 search-terms check, Google + Bing + Bing AI
# against each page's first screen): "cbot corn futures quotes", "chicago board of trade corn
# price", "cbot soybeans" (2,248 at position 11), "soybean price per bushel"; on cattle, feeder
# searches carry about 19,700 of ~19,900 weight, so feeders come first. Fixed words, no number:
# the price sits right beside the heading. Baked here so a hand edit cannot drift from the title.
H1_CORN = "CBOT corn futures prices today, per bushel"
H1_BEANS = "CBOT soybean futures prices today, per bushel"
H1_CATTLE = "Feeder and live cattle futures prices today"
# 2026-10-18: about 350 KC / Kansas City impressions went to a page whose H1
# said only "Wheat futures". The page shows KC HRW (prices.json kcwheat), so
# the H1 names both. The title stays as it is until the Nov 15 re-measure.
H1_WHEAT = "Chicago and KC wheat futures prices today"


def body_h1(text):
    return lambda c: text


BODY = {
    "corn-futures-prices.html": ("futures-h1", body_h1(H1_CORN)),
    "soybean-futures-prices.html": ("futures-h1", body_h1(H1_BEANS)),
    "wheat-futures-prices.html": ("futures-h1", body_h1(H1_WHEAT)),
    CATTLE_PAGE: ("cattle-h1", body_h1(H1_CATTLE)),
    "usda-calendar.html": ("next-wasde", body_usda_calendar),
    "usda-quick-stats.html": ("state-yields", body_quick_stats),
    "fertilizer.html": ("fert-bar", body_fertilizer),
    "breakeven.html": [("be-example", body_breakeven), ("be-faq", body_be_faq), ("be-total", body_be_total),
                       ("be-cpb", body_be_cpb, True)],
}


# JSON-LD dateModified, stamped from the data file's own date in the same run
# (2026-10-16 audit: /usda-quick-stats said June 16 in its structured data
# while the body carried the October forecast). Only ever moves forward.
def dm_quick_stats(c):
    u = str(((c["state_stats"] or {}).get("updated") or ""))[:10]
    return u if re.fullmatch(r"\d{4}-\d{2}-\d{2}", u) else None


DATE_MODIFIED = {"usda-quick-stats.html": dm_quick_stats}
_DM = re.compile(r'("dateModified"\s*:\s*")(\d{4}-\d{2}-\d{2})([^"]*")')


def stamp_date_modified(text, iso):
    """(text, n): every JSON-LD dateModified older than iso set to iso."""
    n = 0

    def sub(m):
        nonlocal n
        if m.group(2) >= iso:
            return m.group(0)
        n += 1
        return m.group(1) + iso + '"'
    return _DM.sub(sub, text), n


# ---------------------------------------------------------------- stamping

_ENT = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc(s):
    for a, b in _ENT.items():
        s = s.replace(a, b)
    return s


def check(title, desc, page, owns=frozenset({"title", "desc"})):
    pairs = [("title", title, TITLE_MAX)] if "title" in owns else []
    if "desc" in owns:
        pairs.append(("description", desc, DESC_MAX))
    for label, val, cap in pairs:
        if not val or not val.strip():
            raise ValueError(f"{page}: empty {label}")
        if '"' in val:
            raise ValueError(f'{page}: {label} contains a double quote, which '
                             f'would break the meta attribute: {val!r}')
        if len(val) > cap:
            raise ValueError(f"{page}: {label} is {len(val)} chars, cap is {cap}: {val!r}")
    return True


def _meta(attr, val):
    # these pages column-align their attributes, so the gap before content= is a
    # RUN of spaces. A single-space pattern matched 3 of 6 tags and said nothing.
    return re.compile(r'(<meta\s+' + attr + r'="' + val + r'"\s+content=")([^"]*)(")')


TAGS = [
    (re.compile(r"(<title>)(.*?)(</title>)", re.S), "title"),
    (_meta("name", "description"), "desc"),
    (_meta("property", "og:title"), "title"),
    (_meta("property", "og:description"), "desc"),
    (_meta("name", "twitter:title"), "title"),
    (_meta("name", "twitter:description"), "desc"),
    # og:image:alt repeats the title on pages that own it ("alt"). It was left
    # out of the stamp list, so /conditions said "Corn 57%" in the share-card
    # alt while its title said 54%. Opt-in per page: on pages whose alt
    # describes the image rather than repeating the title it is left alone.
    (_meta("property", "og:image:alt"), "alt"),
]
EXPECT_TAGS = 6


# The page's JSON-LD WebPage "name" follows the title too (night SEO audit, Oct 19, 2026): it was
# typed once and drifted, e.g. cattle-futures-prices named "Live Cattle & Feeder Cattle Futures
# Prices Today" under a title that leads with feeders and carries the settles. Only a WebPage node,
# and only its own "name": a flat nested object before it (an author) is stepped over whole, so a
# name inside it, or in a breadcrumb list, is never touched.
_LD_NAME = re.compile(r'("@type":\s*"WebPage"(?:[^{}]|\{[^{}]*\})*?"name":\s*")((?:[^"\\]|\\.)*)(")')


def stamp_ld_name(text, title):
    """(text, n): the WebPage name in each JSON-LD block set to the title without the suffix."""
    name = (title or "")
    if name.endswith(SUFFIX):
        name = name[:-len(SUFFIX)]
    if not name:
        return text, 0
    val = json.dumps(name, ensure_ascii=False)[1:-1].replace("</", "<\\/")
    n = 0

    def blk(m):
        nonlocal n
        new, c = _LD_NAME.subn(lambda mm: mm.group(1) + val + mm.group(3), m.group(2))
        n += c
        return m.group(1) + new + m.group(3)
    out = re.sub(r'(<script type="application/ld\+json">)(.*?)(</script>)', blk, text, flags=re.S)
    return out, n


def stamp(text, title, desc, owns=frozenset({"title", "desc"})):
    vals = {"title": esc(title or ""), "desc": esc(desc or ""), "alt": esc(title or "")}
    n = 0
    for pat, which in TAGS:
        if which not in owns:
            continue
        new, cnt = pat.subn(lambda m: m.group(1) + vals[which] + m.group(3), text, count=1)
        if cnt:
            text, n = new, n + 1
    if "title" in owns:
        text, _ = stamp_ld_name(text, title)   # not counted: a page may have no WebPage node
    return text, n


def bake_body(text, name, inner, every=False):
    """(text, found). Replaces what sits between the markers (the first pair,
    or every pair with every=True); found is False when the page has no such
    markers (markup changed: write nothing)."""
    pat = re.compile(r"(<!--BAKE:" + re.escape(name) + r"-->)(.*?)(<!--/BAKE-->)", re.S)
    if not pat.search(text):
        return text, False
    return pat.sub(lambda m: m.group(1) + inner + m.group(3), text, count=0 if every else 1), True


def expected_tags(owns):
    return sum(1 for _, which in TAGS if which in owns)


# ---------------------------------------------------------------- main

def run(today, dry=False, only=None):
    ctx = build_ctx(today)
    changed, skipped = [], []
    for page, (fn, owns) in PAGES.items():
        if only and page != only:
            continue
        p = REPO / page
        if not p.exists():
            skipped.append((page, "file missing")); continue
        try:
            got = fn(ctx)
        except Exception as exc:                          # noqa: BLE001
            skipped.append((page, f"builder raised: {exc}")); continue
        if not got:
            skipped.append((page, "no data — left alone")); continue
        title, desc = got
        try:
            check(title, desc, page, owns)
        except ValueError as exc:
            skipped.append((page, str(exc))); continue
        src = p.read_text(encoding="utf-8")
        out, n = stamp(src, title, desc, owns)
        want = expected_tags(owns)
        if n != want:
            skipped.append((page, f"stamped {n} of {want} tags — markup changed; "
                                  f"refusing to half-update"))
            continue
        if page in BODY:
            # one (name, fn) or a list of them; a third item True bakes every
            # copy of that marker (one value shown in several places)
            specs = BODY[page] if isinstance(BODY[page], list) else [BODY[page]]
            bad = None
            for spec in specs:
                name, bfn = spec[0], spec[1]
                try:
                    inner = bfn(ctx)
                except Exception as exc:                      # noqa: BLE001
                    bad = f"body builder raised: {exc}"; break
                out, found = bake_body(out, name, inner, every=len(spec) > 2 and spec[2])
                if not found:
                    bad = f"no <!--BAKE:{name}--> markers: markup changed; refusing to half-update"; break
                print(f"  body  {re.sub(r'<[^>]+>', '', inner)}")
            if bad:
                skipped.append((page, bad)); continue
        if page in FAQ_BAKE:
            bad = None
            for q, ffn in FAQ_BAKE[page]:
                try:
                    out, ok = bake_faq_answer(out, q, ffn(ctx))
                except Exception as exc:                      # noqa: BLE001
                    bad = f"FAQ builder raised: {exc}"; break
                if not ok:
                    bad = f"FAQ {q!r} not found once in JSON-LD and page; refusing to half-update"; break
                print(f"  faq   {q}")
            if bad:
                skipped.append((page, bad)); continue
        if page in DATE_MODIFIED:
            iso = DATE_MODIFIED[page](ctx)
            if iso:
                out, k = stamp_date_modified(out, iso)
                if k:
                    print(f"  dateModified -> {iso}")
        print(f"\n{page}  ({n} tags, owns {'+'.join(sorted(owns))})")
        if title:
            print(f"  title [{len(title):>3}] {title}")
        if desc:
            print(f"  desc  [{len(desc):>3}] {desc}")
        if not dry and out != src:
            p.write_text(out, encoding="utf-8")
            changed.append(page)
        elif out == src:
            print("  (unchanged)")
    print("\n" + "-" * 60)
    print(f"changed {len(changed)}: {', '.join(changed) or 'none'}")
    for pg, why in skipped:
        print(f"skipped {pg}: {why}")
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  — {detail}" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    T = date(2026, 8, 16)
    ctx = {"today": T, "next_wasde": date(2026, 9, 11),
           "yield_panel": {"crops": {"corn": {"rows": [
               {"id": "usda", "value": 180.7, "as_of": "2026-08-12"},
               {"id": "profarmer", "value": 173.2, "as_of": "2026-08-21"}]}}},
           "cot": {"report_date": "August 11, 2026",
                   "corn": {"net": 125875, "prev": 144821}},
           "crop_tour": {"tour": {"year": 2026, "start": "2026-08-17", "end": "2026-08-20"},
                         "nights": [{"posted": False}] * 4, "benchmarks": {}},
           "state_stats": {"stateStats": {"IA": {"corn_yield": 216.0, "year": 2026,
                                                 "forecast": True}}},
           # The week with the HIGHEST r2 must win, not the last one in the
           # dict and not a week somebody liked: 39 here, not 22.
           "cond_yield": {"crops": {"corn": {"states": {"IA": {"weeks": {
               "22": {"r2": 0.003, "n": 26}, "35": {"r2": 0.59, "n": 26},
               "39": {"r2": 0.64, "n": 26}}}}}}},
           "dairy": {"class_month": "July 2026", "class_month_key": "2026-07",
                     "class3": 17.5, "class4": 18.04, "class3_prev": 17.62},
           "crop_progress": {"in_season": True,
                             "corn": {"good_excellent": 57, "good_excellent_prev_year": 66},
                             "soybeans": {"good_excellent": 58}},
           "basis": {"series": {
               "Corn|Iowa|Elevator Bid": {"latest": -0.432, "date": "2026-08-14", "avg5": -0.308, "delta": -0.124},
               "Corn|Minnesota|Elevator Bid": {"latest": -0.912, "date": "2026-08-14", "avg5": -0.448, "delta": -0.464},
               "Corn|Indiana|Elevator Bid": {"latest": -0.202, "date": "2026-08-14", "avg5": -0.334, "delta": 0.132},
               "Corn|Ohio|Elevator Bid": {"latest": -0.9, "date": "2026-07-01", "avg5": -0.3, "delta": -0.6},
               "Soybeans|Iowa|Elevator Bid": {"latest": -0.47, "date": "2026-08-14", "avg5": -0.6, "delta": 0.13}}},
           # data/fertilizer-prices.json shape (scripts/build_fert_prices.py)
           "fertilizer": {"prices": [
               {"key": "urea", "name": "Urea", "price": 622.98, "as_of": "2026-08-01", "src": "coop", "region": "Kansas"},
               {"key": "anhydrous", "name": "Anhydrous ammonia", "price": 832.1, "as_of": "2026-08-01", "src": "coop", "region": "Kansas"},
               {"key": "uan32", "name": "UAN 32%", "price": 530.0, "as_of": "2026-07-28", "src": "ams"},
               {"key": "dap", "name": "DAP", "price": 650.0, "as_of": "2026-06-20", "src": "coop"},
               {"key": "potash", "name": "Potash", "price": 470.4, "as_of": "2026-07-28", "src": "ams"}]},
           "prices": {"fetched": "2026-08-15T04:35:00Z",
                      # every quote is dated: titles take finished sessions only
                      # (11:35 p.m. CT Friday: past the cattle settle, see SETTLE_CT)
                      "quotes": {"corn": {"close": 459.25, "close_date": "2026-08-14"},
                                 "beans": {"close": 1176.25, "close_date": "2026-08-14"},
                                 "wheat": {"close": 674.0, "close_date": "2026-08-14"},
                                 "cattle": {"close": 223.75, "close_date": "2026-08-14"},
                                 "feeders": {"close": 341.275, "close_date": "2026-08-14"}},
                      "nearby": {"corn": {"label": "Sep '26"}, "beans": {"label": "Aug '26"},
                                 "wheat": {"label": "Sep '26"}, "cattle": {"label": "Aug '26"}}}}

    print("titles lead with the answer")
    t, d = seo_usda_calendar(ctx)
    ck("WASDE title leads with the searched words", t.startswith("WASDE & USDA Report Dates 2026"), t)
    ck("WASDE title names the next date", t.endswith("Next WASDE Sep 11" + SUFFIX), t)
    # Changed 2026-10-13 with the copy: the description gives the weekday and
    # the release time instead of a day count that went stale between bakes.
    ck("WASDE description gives the weekday, date and release time",
       "is Friday, Sep 11, 2026, at noon ET (11 a.m. CT)" in d, d)
    ck("WASDE description names no day count", "days" not in d, d)
    ck("WASDE description names only reports the page lists", "Cattle on Feed" not in d, d)
    _rd = seo_usda_calendar(dict(ctx, today=date(2026, 9, 11)))[1]
    ck("on report day it says today", "is today, Sep 11, 2026" in _rd, _rd)
    _nt, _nd = seo_usda_calendar(dict(ctx, next_wasde=None))
    ck("past the date table: only reports the page lists", "Cattle on Feed" not in _nd, _nd)
    ck("past the date table: no next date is claimed",
       "Next" not in _nt and "next" not in _nd and not re.search(r"\d{4}", _nt + _nd), _nt + " / " + _nd)

    print("\nusda calendar: next crop report and report times, from the page's schedule")
    _cr_rows = cal_reports()
    ck("the page's REPORTS list parses", _cr_rows and len(_cr_rows) > 40, len(_cr_rows or []))
    cctx = dict(ctx, cal_reports=_cr_rows, today=date(2026, 10, 18), next_wasde=date(2026, 11, 10))
    ct, cd = seo_usda_calendar(cctx)
    # Changed 2026-10-19 (Sig): the Oct 11 title stands every month; the
    # Oct 18 "Next WASDE & Crop Production" title is gone.
    ck("when Crop Production comes with the WASDE, the title is still the Oct 11 one",
       ct == "WASDE & USDA Report Dates 2026: Next WASDE Nov 10" + SUFFIX, ct)
    ck("...and never names Crop Production", "Crop Production" not in ct, ct)
    ck("...and the description gives weekday, date and noon ET",
       cd.startswith("Next USDA crop report: WASDE and Crop Production, Tuesday, Nov 10, 2026, at noon ET (11 a.m. CT).")
       and "4 p.m. ET" in cd and len(cd) <= DESC_MAX, cd)
    for _m, _d in ((1, 12), (12, 10)):
        _w = date(2026, _m, _d)
        _x = seo_usda_calendar(dict(cctx, today=_w - timedelta(days=3), next_wasde=_w))
        ck(f"every month fits the caps ({_w})", check(_x[0], _x[1], "usda-calendar.html"), _x)
    _off = seo_usda_calendar(dict(cctx, today=date(2026, 12, 7), next_wasde=date(2026, 12, 10)))[1]
    ck("out of Crop Progress season the description names no Crop Progress", "Crop Progress" not in _off, _off)
    _noc = seo_usda_calendar(dict(cctx, cal_reports=[r for r in _cr_rows if r["name"] != "Crop Production"]))
    ck("no Crop Production that day: the WASDE-only title stands",
       _noc[0].startswith("WASDE & USDA Report Dates 2026") and _noc[0].endswith("Next WASDE Nov 10" + SUFFIX), _noc)
    fa = faq_next_crop(dict(cctx, today=date(2026, 10, 18), next_wasde=date(2026, 11, 10)))
    ck("next crop report FAQ: Nov 10 at noon ET, from the page",
       "WASDE and Crop Production, come out Tuesday, Nov 10, 2026, at 12:00 p.m. ET (11 a.m. CT)." in fa
       and "Mondays at 4:00 p.m. ET through Nov 30, 2026" in fa, fa)
    fa = faq_next_crop(dict(cctx, today=date(2026, 11, 10), next_wasde=date(2026, 12, 10)))
    ck("after the Nov 10 print the next is Dec 10", "Thursday, Dec 10, 2026" in fa and "Nov 10" not in fa, fa)
    fa = faq_next_crop(dict(cctx, today=date(2026, 11, 10), next_wasde=date(2026, 11, 10)))
    ck("on report day before the print it says today", "come out today, Nov 10, 2026" in fa, fa)
    fa = faq_next_crop(dict(cctx, today=date(2026, 12, 20), next_wasde=None))
    ck("past the table no date is claimed", not re.search(r"\d", fa), fa)
    ft = faq_report_times(cctx)
    ck("times FAQ: noon, 3 p.m., 4 p.m. and 8:30 a.m. ET",
       all(x in ft for x in ("12:00 p.m. ET", "3:00 p.m. ET", "4:00 p.m. ET", "8:30 a.m. ET")), ft)
    _moved = [dict(r, time="3:00 PM ET") if r["name"] == "Crop Production" else r for r in _cr_rows]
    try:
        faq_report_times(dict(cctx, cal_reports=_moved))
        ck("a time the page changes makes the times FAQ refuse", False)
    except ValueError:
        ck("a time the page changes makes the times FAQ refuse", True)
    _ft_page = (REPO / "usda-calendar.html").read_text(encoding="utf-8")
    for _q in (Q_NEXT_CROP, Q_TIMES):
        ck(f"the page carries {_q!r} once in JSON-LD and once visible",
           bake_faq_answer(_ft_page, _q, "x" * 30)[1])
    try:
        bake_faq_answer(_ft_page, Q_TIMES, 'He said "noon"')
        ck("an answer that needs escaping is refused", False)
    except ValueError:
        ck("an answer that needs escaping is refused", True)
    for _a in (fa, ft):
        ck("no em dash in a baked FAQ", "\u2014" not in _a, _a)

    print("\nusda calendar: the visible next-WASDE line")
    import usda_dates as _ud
    b = body_usda_calendar(ctx)
    ck("the line names the next WASDE with weekday and time",
       "Next WASDE: Friday, Sep 11, 2026, at noon ET (11 a.m. CT)." in b, b)
    ck("the line lists every WASDE date in the table",
       all(f"{MONTHS[x.month - 1][:3]} {x.day}" in b for x in _ud.WASDE_2026), b)
    b0 = body_usda_calendar(dict(ctx, next_wasde=None))
    ck("past the table the line claims no next date", "Next" not in b0, b0)
    try:
        body_usda_calendar(dict(ctx, next_wasde=date(2026, 1, 1)))
        ck("a past WASDE in the body line raises", False, "it returned a line")
    except ValueError:
        ck("a past WASDE in the body line raises", True)
    _cal = (REPO / "usda-calendar.html").read_text(encoding="utf-8")
    ck("usda-calendar.html carries the next-wasde markers",
       bake_body(_cal, "next-wasde", "x")[1])
    _page_w = set(re.findall(r"\{date:'(\d{4}-\d\d-\d\d)',name:'WASDE'", _cal))
    _tbl = {x.isoformat() for x in _ud.WASDE_2026}
    ck("the page's WASDE rows hold every date the line prints", _tbl <= _page_w,
       f"missing on the page: {sorted(_tbl - _page_w)}")
    ck("every page WASDE time is noon ET, as the line says",
       all("12:00 PM ET" in m for m in re.findall(r"\{date:'2026-[^}]*name:'WASDE'[^}]*\}", _cal)))
    _bo, _bf = bake_body("<p><!--BAKE:next-wasde-->old<!--/BAKE--></p>", "next-wasde", "new")
    ck("body bake replaces between the markers", _bf and _bo == "<p><!--BAKE:next-wasde-->new<!--/BAKE--></p>", _bo)
    ck("body bake reports missing markers", bake_body("<p>x</p>", "next-wasde", "y")[1] is False)

    print("\nfutures H1s: the words people search, baked between markers")
    for _pg, _nm, _want in (("corn-futures-prices.html", "futures-h1", H1_CORN),
                            ("soybean-futures-prices.html", "futures-h1", H1_BEANS),
                            ("wheat-futures-prices.html", "futures-h1", H1_WHEAT),
                            (CATTLE_PAGE, "cattle-h1", H1_CATTLE)):
        _src = (REPO / _pg).read_text(encoding="utf-8")
        ck(f"{_pg} has one <h1> holding the {_nm} markers",
           len(re.findall(r"<h1[ >]", _src)) == 1 and re.search(r"<h1><!--BAKE:" + _nm + r"-->[^<]*<!--/BAKE--></h1>", _src))
        ck(f"{_pg} H1 rule is registered", any(sp[0] == _nm for sp in (BODY[_pg] if isinstance(BODY[_pg], list) else [BODY[_pg]])))
        _out, _ok = bake_body(_src, _nm, BODY[_pg][1](ctx))
        ck(f"{_pg} H1 bakes to the rule's words", _ok and f"<!--BAKE:{_nm}-->{_want}<!--/BAKE-->" in _out)
        ck(f"{_pg} H1 has no number and no dash", not re.search(r"\d|\u2014|\u2013", _want), _want)
    ck("corn and soybean H1s name CBOT and per bushel",
       all("CBOT" in x and "per bushel" in x for x in (H1_CORN, H1_BEANS)))
    ck("cattle H1 leads with feeders", H1_CATTLE.startswith("Feeder"))
    _px = json.loads((DATA / "prices.json").read_text(encoding="utf-8"))
    ck("wheat H1 names KC only while the price file carries KC wheat",
       "KC" not in H1_WHEAT or any(k.startswith("kcwheat") for k in (_px.get("quotes") or {})))
    ck("wheat page shows a KC HRW card", 'id="p-kcwheat"' in (REPO / "wheat-futures-prices.html").read_text(encoding="utf-8"))

    t, d = seo_cot(ctx)
    ck("COT title states the position", "Net Long Corn 126k" in t, t)
    # Changed 2026-10-13 with the copy: the report's name and as-of date lead
    # the title, and the description dates it as Aug 11, 2026 (was "August
    # 11, 2026", the file's own spelling).
    ck("COT title leads with the report name and its date",
       t.startswith("CFTC COT Report, Aug 11: Managed Money Net Long Corn 126k"), t)
    ck("COT description carries the report date", "Aug 11, 2026" in d, d)
    ck("COT description spells out the report", d.startswith("CFTC Commitments of Traders"), d)
    _cs = seo_cot(dict(ctx, cot={"report_date": "September 29, 2026", "flat_oi_pct": 2.0,
                                 "corn": {"net": -312345, "prev": -298000}}))
    ck("a short corn position says short", "Net Short Corn 312k" in _cs[0], _cs[0])
    _cf = seo_cot(dict(ctx, cot={"report_date": "September 29, 2026", "flat_oi_pct": 2.0,
                                 "corn": {"net": 4100, "prev": 9000, "side": "flat"}}))
    ck("a flat corn position says near flat, no side in the title",
       "Near Flat in Corn" in _cf[0] and "Long" not in _cf[0], _cf[0])
    _cx = seo_cot(dict(ctx, cot={"report_date": "sometime", "corn": {"net": 125875}}))
    ck("an unreadable report date drops the date, not the page",
       _cx and _cx[0].startswith("CFTC COT Report: Managed Money"), _cx)
    for _c in (_cs, _cf, _cx):
        check(_c[0], _c[1], "cot.html")

    t, d = seo_crop_tour(ctx)
    ck("tour title says it starts tomorrow", "Starts Tomorrow" in t, t)

    ctx2 = dict(ctx, today=date(2026, 8, 19),
                crop_tour=dict(ctx["crop_tour"],
                               nights=[{"posted": True}, {"posted": True}, {"posted": False}, {"posted": False}]))
    t2, _ = seo_crop_tour(ctx2)
    ck("mid-tour title counts posted nights", "Night 2 Results" in t2, t2)

    ctx3 = dict(ctx, today=date(2026, 8, 22),
                crop_tour=dict(ctx["crop_tour"], nights=[{"posted": True}] * 4,
                               benchmarks={"tour": {"corn": 179.4}}))
    t3, _ = seo_crop_tour(ctx3)
    ck("after the tour the title carries the number", "Corn 179.4 bu/ac" in t3, t3)

    print("\nhonesty")
    _panel = {"crops": {"corn": {"rows": [
        {"id": "profarmer", "value": 173.2, "as_of": "2026-08-21"},
        {"id": "dtn", "value": 178.5, "as_of": "2026-08-10"},
        {"id": "agsist", "value": 180.6, "as_of": "2026-10-04"},
        {"id": "usda", "value": 181.2, "as_of": "2026-10-09"}]}}}
    t, d = seo_cond_yield(dict(ctx, yield_panel=_panel))
    ck("cond-yield is titled for what it now leads with", t == "2026 crop size: every forecast | AGSIST", t)
    ck("cond-yield's snippet names USDA's current print and its date first",
       d.startswith("Every 2026 US corn yield forecast side by side: USDA 181.2 (Oct 9), Pro Farmer tour 173.2"), d)
    ck("cond-yield skips when the panel file is missing",
       seo_cond_yield(dict(ctx, yield_panel=None)) is None)
    t, d = seo_conditions(ctx)
    ck("conditions carries this week's G+E and last year's", "57%" in d and "66%" in d)
    ck("conditions with no report date keeps the old title", t == "USDA Crop Conditions: Corn 57% Good-Excellent | AGSIST", t)
    # Oct 19, 2026 (night audit): the Oct 11 report as data/crop-progress.json held it
    _cp11 = {"in_season": True, "report_date": "2026-10-11",
             "corn": {"good_excellent": 56, "report_date": "2026-10-11", "good_excellent_prev_year": None,
                      "harvest_pct": 33, "harvest_date": "2026-10-11"}, "soybeans": {"good_excellent": 61}}
    # Oct 20 (panel B): in harvest season the title leads with the harvest percent; the Oct 11
    # report carried corn 33% harvested and no soybean harvest figure
    t11, _d11 = seo_conditions(dict(ctx, crop_progress=_cp11))
    ck("conditions title names the week ENDING Oct 11, never 'Week of', led by the harvest",
       t11 == "Corn 33% Harvested: Crop Progress, Week Ending Oct 11 | AGSIST" and "Week of" not in t11
       and len(t11) <= TITLE_MAX, t11)
    ck("the harvest description says the percent and the condition", _d11.startswith("US corn is 33% harvested. Corn is 56% good to excellent"), _d11)
    _cpg = dict(_cp11, corn={k: v for k, v in _cp11["corn"].items() if not k.startswith("harvest")})
    tg, _ = seo_conditions(dict(ctx, crop_progress=_cpg))
    ck("no harvest figure (summer): the condition title as before",
       tg == "Crop Progress, Week Ending Oct 11: Corn 56% Good-Excellent | AGSIST", tg)
    _cpo = dict(_cp11, corn=dict(_cp11["corn"], harvest_date="2026-09-27"))
    ck("a harvest figure from an older week does not lead",
       seo_conditions(dict(ctx, crop_progress=_cpo))[0].startswith("Crop Progress, Week Ending Oct 11: Corn 56% Good"))
    _cpd = dict(_cp11, corn=dict(_cp11["corn"], harvest_pct=100))
    ck("a finished harvest does not lead", seo_conditions(dict(ctx, crop_progress=_cpd))[0].startswith("Crop Progress,"))
    # Oct 20 file: corn 44% (5-year 52%), soybeans 64%, week ending Oct 18
    _cp18 = {"in_season": True, "report_date": "2026-10-18",
             "corn": {"good_excellent": 56, "report_date": "2026-10-18", "harvest_pct": 44, "harvest_date": "2026-10-18", "harvest_5yr_avg": 52},
             "soybeans": {"good_excellent": 57, "report_date": "2026-10-11", "harvest_pct": 64, "harvest_date": "2026-10-18", "harvest_5yr_avg": 65}}
    t18, d18 = seo_conditions(dict(ctx, crop_progress=_cp18))
    ck("both crops' harvest in the title, the suffix gives way first",
       t18 == "Corn 44% Harvested, Soybeans 64%: Crop Progress, Week Ending Oct 18" and len(t18) <= TITLE_MAX, t18)
    ck("harvest description within the cap", d18.startswith("US corn is 44% harvested against a 52% five-year average, soybeans 64%.")
       and len(d18) <= DESC_MAX, d18)
    ck("last week's soybean rating is not printed beside this week's corn", "57%" not in d18 and "Corn is 56% good to excellent." in d18, d18)
    cp = dict(ctx["crop_progress"], corn={"good_excellent": 54, "good_excellent_prev_year": None},
              soybeans={"good_excellent": 57})
    _t, d0 = seo_conditions(dict(ctx, crop_progress=cp))
    ck("conditions with no prior-year figure reads cleanly (no ',.')",
       ",." not in d0 and "soybeans 57%." in d0 and "a year ago" not in d0, d0)
    alt_html = ('<title>Old</title><meta name="description" content="o">'
                '<meta property="og:title" content="o"><meta property="og:description" content="o">'
                '<meta name="twitter:title" content="o"><meta name="twitter:description" content="o">'
                '<meta property="og:image:alt" content="USDA Crop Conditions: Corn 57%">')
    _o, _n = stamp(alt_html, "Corn 54%", "D", frozenset({"title", "desc", "alt"}))
    ck("og:image:alt follows the title on pages that own it",
       _n == 7 and 'og:image:alt" content="Corn 54%"' in _o and "57%" not in _o, _o)
    _ld = ('<title>Old | AGSIST</title><script type="application/ld+json">{"@context": "https://schema.org", "@graph": '
           '[{"@type": "WebPage", "@id": "https://agsist.com/x#webpage", "name": "Old typed name | AGSIST", "breadcrumb": '
           '{"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": 1, "name": "Home"}]}}]}</script>')
    _lo, _ = stamp(_ld, 'CME Feeder Cattle Futures $343.625 & "Live" | AGSIST', "D", frozenset({"title"}))
    _lj = json.loads(re.search(r'json">(.*?)</script>', _lo).group(1))["@graph"][0]
    ck("the JSON-LD WebPage name follows the title (suffix off), breadcrumb names untouched",
       _lj["name"] == 'CME Feeder Cattle Futures $343.625 & "Live"'
       and _lj["breadcrumb"]["itemListElement"][0]["name"] == "Home", _lo)
    _lq = ('<script type="application/ld+json">{"@type":"WebPage","author":{"@type":"Person","name":"Sigurd Lindquist"},'
           '"name":"Old"}</script>')
    _lqo = stamp_ld_name(_lq, "New title | AGSIST")[0]
    ck("an author object before the name is stepped over, the author's name kept",
       '"name":"Sigurd Lindquist"' in _lqo and '"name":"New title"}' in _lqo, _lqo)
    ck("a page that does not own its title keeps its JSON-LD name",
       "Old typed name" in stamp(_ld, "New", "D", frozenset({"desc"}))[0])
    ck("og:image:alt left alone on pages that do not own it",
       "57%" in stamp(alt_html, "Corn 54%", "D")[0])
    ck("conditions stays quiet out of season",
       seo_conditions(dict(ctx, crop_progress={"in_season": False})) is None)

    # Label strings changed 2026-10-13 with the copy ("USDA September 2026
    # forecast" where the description used to say "(2026 USDA September
    # forecast)"); what is asserted is unchanged: a forecast is called a
    # forecast, its month is named, a final is called a final.
    t, d = seo_quick_stats(ctx)
    ck("a forecast is called a forecast, never a final", "2026 forecast" in d and "final" not in d, d)
    ck("...in the title too", "2026 Forecast" in t and "Final" not in t, t)
    _qs = seo_quick_stats(dict(ctx, state_stats={"stateStats": {"IA": {
        "name": "Iowa", "corn_yield": 219.0, "corn_prod": 2803, "bean_yield": 63.0, "bean_prod": 613,
        "year": 2026, "forecast": True, "forecast_month": "September"},
        "IL": {"name": "Illinois", "corn_yield": 208.0, "corn_prod": 2278, "bean_yield": 68.0,
               "bean_prod": 709, "year": 2026, "forecast": True, "forecast_month": "September"},
        "NE": {"name": "Nebraska", "corn_yield": 188.0, "corn_prod": 1807,
               "year": 2026, "forecast": True, "forecast_month": "August"},
        "MN": {"name": "Minnesota", "corn_yield": 195.0, "corn_prod": 1618,
               "year": 2026, "forecast": True, "forecast_month": "September"}}}))
    ck("quick stats names the month of the forecast", "USDA September 2026 forecast" in _qs[1], _qs[1])
    ck("and still fits the caps with the longest month", check(_qs[0], _qs[1], "usda-quick-stats.html"))
    ck("the description leads with the largest states",
       "Iowa corn 219 bu/ac, Illinois 208, Minnesota 195; Illinois soybeans 68" in _qs[1], _qs[1])
    ck("a state on another month's forecast is left out", "Nebraska" not in _qs[1], _qs[1])
    # three soybean states when the file has them, largest growers first, same vintage
    _qs3_ss = {"stateStats": {
        "IA": {"name": "Iowa", "corn_yield": 219.0, "corn_prod": 2803, "bean_yield": 63.0, "bean_prod": 613,
               "year": 2026, "forecast": True, "forecast_month": "October"},
        "IL": {"name": "Illinois", "corn_yield": 208.0, "corn_prod": 2278, "bean_yield": 68.0, "bean_prod": 709,
               "year": 2026, "forecast": True, "forecast_month": "October"},
        "NE": {"name": "Nebraska", "corn_yield": 188.0, "corn_prod": 1807, "bean_yield": 59.0, "bean_prod": 300,
               "year": 2026, "forecast": True, "forecast_month": "October"},
        "MN": {"name": "Minnesota", "corn_yield": 195.0, "corn_prod": 1618, "bean_yield": 49.0, "bean_prod": 350,
               "year": 2026, "forecast": True, "forecast_month": "October"},
        "SD": {"name": "South Dakota", "bean_yield": 99.0, "bean_prod": 999,
               "year": 2026, "forecast": True, "forecast_month": "September"}}}
    _qs3 = seo_quick_stats(dict(ctx, state_stats=_qs3_ss))
    ck("three soybean states, by production, same vintage only",
       "Illinois soybeans 68, Iowa 63, Minnesota 49." in _qs3[1] and "South Dakota" not in _qs3[1], _qs3[1])
    ck("...and it fits the caps", check(_qs3[0], _qs3[1], "usda-quick-stats.html") and len(_qs3[1]) <= DESC_MAX, _qs3[1])
    _qsc = seo_quick_stats(dict(ctx, nass_years=(2010, 2025), state_stats=_qs3_ss))
    ck("quick stats names the CSV years and keeps three soybean states",
       "2010 to 2025 finals" in _qsc[1] and "CSV" in _qsc[1] and "Minnesota 49." in _qsc[1]
       and len(_qsc[1]) <= DESC_MAX, _qsc[1])
    ck("the CSV years come from the data files", nass_years() is None or
       nass_years()[0] == 2010 and nass_years()[1] < date.today().year + 1, nass_years())
    ck("no years claimed without the data", "finals" not in seo_quick_stats(dict(ctx, nass_years=None, state_stats=_qs3_ss))[1])
    _qsl = seo_quick_stats(dict(ctx, state_stats={"stateStats": {k: dict(v, name=v["name"] * 3) for k, v in
        {"IA": {"name": "Iowa", "corn_yield": 219.0, "corn_prod": 2803, "bean_yield": 63.0, "bean_prod": 613, "year": 2026, "forecast": True, "forecast_month": "September"},
         "IL": {"name": "Illinois", "corn_yield": 208.0, "corn_prod": 2278, "bean_yield": 68.0, "bean_prod": 709, "year": 2026, "forecast": True, "forecast_month": "September"},
         "MN": {"name": "Minnesota", "corn_yield": 195.0, "corn_prod": 1618, "bean_yield": 49.0, "bean_prod": 350, "year": 2026, "forecast": True, "forecast_month": "September"}}.items()}}))
    ck("long state names drop soybean states before breaking the cap", len(_qsl[1]) <= DESC_MAX, _qsl[1])
    ctx4 = dict(ctx, state_stats={"stateStats": {"IA": {"corn_yield": 211.0, "year": 2025,
                                                        "forecast": False}}})
    t4, d4 = seo_quick_stats(ctx4)
    ck("a final is called a final", "2025 final" in d4 and "forecast" not in d4, d4)
    ck("...in the title too", "USDA 2025 Final" in t4 and "Forecast" not in t4, t4)
    _b = body_quick_stats(dict(ctx, state_stats=_qs and {"stateStats": {"IA": {
        "name": "Iowa", "corn_yield": 219.0, "corn_prod": 2803, "bean_yield": 63.0, "bean_prod": 613,
        "year": 2026, "forecast": True, "forecast_month": "October"}}}))
    ck("the visible state line names its vintage", "USDA October 2026 forecast" in _b, _b)
    _j = '{"@type":"WebPage","dateModified":"2026-06-16","x":1}'
    ck("dateModified moves to the data date",
       stamp_date_modified(_j, "2026-10-15") == ('{"@type":"WebPage","dateModified":"2026-10-15","x":1}', 1))
    ck("dateModified never moves back", stamp_date_modified(_j, "2026-01-02") == (_j, 0))
    ck("dateModified date comes from state-stats updated",
       dm_quick_stats({"state_stats": {"updated": "2026-10-15T17:19:12Z"}}) == "2026-10-15"
       and dm_quick_stats({"state_stats": {}}) is None)
    _qp = (REPO / "usda-quick-stats.html").read_text(encoding="utf-8")
    ck("usda-quick-stats.html JSON-LD has a dateModified to stamp", _DM.search(_qp) is not None)
    ck("usda-quick-stats.html carries the state-yields markers",
       bake_body(_qp, "state-yields", "x")[1])

    # THE 2026-08-17 BUG. Day one of the tour, nothing announced yet, and the
    # title said "Night 1 Results". Every assertion below is on the state that
    # shipped wrong, not on the state that happened to work.
    for label, day in (("day one of the tour", date(2026, 8, 17)),
                       ("mid-tour before that night's meeting", date(2026, 8, 19))):
        t0, d0 = seo_crop_tour(dict(ctx, today=day,
                                    crop_tour=dict(ctx["crop_tour"],
                                                   nights=[{"posted": False}] * 4)))
        ck(f"{label} claims no night", re.search(r"Night \d", t0) is None, t0)
        ck(f"{label} still names the tour and the year",
           "Pro Farmer Crop Tour 2026" in t0, t0)
        ck(f"{label} description promises a schedule, not a result",
           "posted each night" in d0, d0)
    t1, _ = seo_crop_tour(dict(ctx, today=date(2026, 8, 17),
                               crop_tour=dict(ctx["crop_tour"],
                                              nights=[{"posted": True}, {"posted": False},
                                                      {"posted": False}, {"posted": False}])))
    ck("the night the first one posts, Night 1 is earned", "Night 1 Results" in t1, t1)
    ck("the pre-tour title fits the cap on every day of the run-up",
       all(len(seo_crop_tour(dict(ctx, today=date(2026, 8, d_)))[0]) <= TITLE_MAX
           for d_ in range(1, 17)),
       max((seo_crop_tour(dict(ctx, today=date(2026, 8, d_)))[0]
            for d_ in range(1, 17)), key=len))
    ck("no reachable state prints Night 0",
       all("Night 0" not in (seo_crop_tour(dict(ctx, today=date(2026, 8, d_),
                                                crop_tour=dict(ctx["crop_tour"],
                                                               nights=[{"posted": False}] * 4)))[0])
           for d_ in (17, 18, 19, 20, 21, 22)))

    print("\nbreak-even example comes from the calculator's own defaults")
    _fake = ("var CROP_DEFAULTS={corn:{yield:180,price:'',basis:0,seed:125,fertilizer:175,"
             "chemicals:65,insurance:35,machinery:145,labor:35,land:250,overhead:75},"
             "soybeans:{yield:55,price:'',basis:0,seed:75,fertilizer:45,chemicals:55,"
             "insurance:30,machinery:110,labor:30,land:250,overhead:55}};")
    ck("corn defaults sum the eight cost lines", _be_defaults("corn", _fake) == (905.0, 180.0),
       str(_be_defaults("corn", _fake)))
    ck("soybean defaults", _be_defaults("soybeans", _fake) == (650.0, 55.0),
       str(_be_defaults("soybeans", _fake)))
    ck("price and basis are not costs", _be_defaults("corn", _fake.replace("price:''", "price:'4.5'"))[0] == 905.0)
    ck("a page without the table gives no example", _be_defaults("corn", "nothing") is None)
    _bt, _bd = seo_breakeven(ctx)
    ck("break-even title names the query's words", "Break-Even Price per Bushel" in _bt, _bt)
    _live = _be_defaults("corn")
    ck("breakeven.html still carries CROP_DEFAULTS", _live is not None)
    if _live:
        ck("the snippet's example is the calculator's opening numbers",
           f"${_live[0] / _live[1]:.2f} corn break-even" in _bd and "Example" in _bd, _bd)
        ck("the visible example line agrees", f"${_live[0] / _live[1]:.2f} a bushel" in body_breakeven(ctx))
    _bp = (REPO / "breakeven.html").read_text(encoding="utf-8")
    ck("breakeven.html carries the be-example markers", bake_body(_bp, "be-example", "x")[1])
    ck("the cost lines' crop year is read from the page", _be_budget_year("var BUDGETS={year:2027,src:'x'") == 2027
       and _be_budget_year("nothing") is None)
    _p27 = {"quotes": {"corn": {"close": 474.25}, "corn-dec27": {"close": 506.75}}}
    if _be_budget_year() == 2027:
        ck("the snippet quotes the budget's crop year board: Dec '27, not Dec '26",
           "Dec '27 futures are near $5.06" in seo_breakeven(dict(ctx, prices=_p27))[1], seo_breakeven(dict(ctx, prices=_p27))[1])
        ck("no Dec '27 quote: the front board, unnamed",
           "; futures are near $4.74" in seo_breakeven(dict(ctx, prices={"quotes": {"corn": {"close": 474.25}}}))[1])

    print("\nusda calendar rolls at the print")
    ck("report morning, not printed: Oct 9 is next",
       next_unprinted_wasde(date(2026, 10, 9), {"release": "2026-09-11"}) == date(2026, 10, 9))
    ck("report day, printed: Nov 10 is next",
       next_unprinted_wasde(date(2026, 10, 9), {"release": "2026-10-09"}) == date(2026, 11, 10))
    ck("the day after: Nov 10, printed or not",
       next_unprinted_wasde(date(2026, 10, 10), None) == date(2026, 11, 10))
    ck("the title names it", seo_usda_calendar(dict(ctx, today=date(2026, 10, 10),
                                                     next_wasde=date(2026, 11, 10)))[0].startswith("WASDE & USDA Report Dates 2026: Next WASDE Nov 10 |"))

    print("\nrails")
    try:
        seo_usda_calendar(dict(ctx, next_wasde=date(2026, 1, 1)))
        ck("a WASDE date in the past raises", False, "it returned a title")
    except ValueError:
        ck("a WASDE date in the past raises", True)
    ck("no data means skip, not a placeholder",
       seo_cot(dict(ctx, cot=None)) is None and
       seo_quick_stats(dict(ctx, state_stats=None)) is None and
       seo_breakeven(dict(ctx, prices=None)) is None)
    try:
        check('He said "hello"', "fine", "x.html"); ck("a double quote is refused", False)
    except ValueError:
        ck("a double quote is refused", True)
    try:
        check("t" * (TITLE_MAX + 1), "fine", "x.html"); ck("an over-long title is refused", False)
    except ValueError:
        ck("an over-long title is refused", True)
    try:
        check("fine", "d" * (DESC_MAX + 1), "x.html"); ck("an over-long description is refused", False)
    except ValueError:
        ck("an over-long description is refused", True)

    print("\nevery live builder fits the caps")
    for page, (fn, owns) in PAGES.items():
        got = fn(ctx)
        if not got:
            ck(f"{page} produced output", False, "returned None"); continue
        try:
            check(got[0], got[1], page, owns); ck(f"{page} within caps", True)
        except ValueError as exc:
            ck(f"{page} within caps", False, str(exc))
    # every crop-tour branch, not just the one today's date happens to hit
    for label, day, nights, bench in (
            ("before", date(2026, 8, 14), [{"posted": False}] * 4, {}),
            ("starts tomorrow", date(2026, 8, 16), [{"posted": False}] * 4, {}),
            ("day one, nothing posted", date(2026, 8, 17), [{"posted": False}] * 4, {}),
            ("mid-tour, two posted", date(2026, 8, 19),
             [{"posted": True}, {"posted": True}, {"posted": False}, {"posted": False}], {}),
            ("over, no national number", date(2026, 8, 22), [{"posted": True}] * 4, {}),
            ("over, national number in", date(2026, 8, 22), [{"posted": True}] * 4,
             {"tour": {"corn": 179.4}})):
        got = seo_crop_tour(dict(ctx, today=day,
                                 crop_tour=dict(ctx["crop_tour"], nights=nights,
                                                benchmarks=bench)))
        try:
            check(got[0], got[1], f"crop-tour.html ({label})")
            ck(f"crop tour '{label}' within caps [{len(got[0])}]", True)
        except ValueError as exc:
            ck(f"crop tour '{label}' within caps", False, str(exc))

    print("\nfutures titles carry the exchange the query uses")
    # wheat changed 2026-10-13 to "Futures Price", the form corn and beans
    # took on 2026-10-11; the assertion follows that copy.
    for page, want in (("wheat-futures-prices.html", "CBOT Wheat Futures Price: Sep '26 $6.74"),
                       ("corn-futures-prices.html", "CBOT Corn Futures Price: Sep '26 $4.59"),
                       ("soybean-futures-prices.html", "CBOT Soybean Futures Price: Aug '26 $11.76"),
                       ("cattle-futures-prices.html", "CME Feeder Cattle Futures $341.27")):
        t, d = PAGES[page][0](ctx)
        ck(f"{page.split('-')[0]} title leads with the exchange and the price",
           t.startswith(want), t)
        if page != CATTLE_PAGE:
            ck(f"{page.split('-')[0]} writes no description", d is None)
    ck("grain boards convert from cents, cattle does not",
       "$4.59" in PAGES["corn-futures-prices.html"][0](ctx)[0] and
       "$223.75" in PAGES[CATTLE_PAGE][0](ctx)[0])
    ck("the cattle title names BOTH animals with BOTH prices",
       all(x in PAGES[CATTLE_PAGE][0](ctx)[0]
           for x in ("Feeder Cattle Futures", "$341.27", "Live Cattle", "$223.75")),
       PAGES[CATTLE_PAGE][0](ctx)[0])
    ck("cattle is skipped if only one of the two prices is there",
       PAGES[CATTLE_PAGE][0](dict(ctx, prices={"quotes": {"cattle": {"close": 223.75}}})) is None)
    # Fetched after 11:30 p.m. CT, when the bar is the settle (2026-10-17: a
    # 3:05 p.m. CT bar is the last trade, not a close, and is not baked).
    trap = dict(ctx, prices={
        "fetched": "2026-08-15T04:45:00Z",
        "quotes": {"beans": {"close": 1176.25, "close_date": "2026-08-14"},         # continuous, Sep
                   "beans-nearby": {"close": 1167.0, "close_date": "2026-08-14"}},  # the dated front, Aug
        "nearby": {"beans": {"label": "Aug '26"}}})
    ck("the price matches the contract the label names",
       "$11.67" in PAGES["soybean-futures-prices.html"][0](trap)[0],
       PAGES["soybean-futures-prices.html"][0](trap)[0])
    ck("...and never the continuous series under a dated label",
       "$11.76" not in PAGES["soybean-futures-prices.html"][0](trap)[0])
    ck("a futures page with no price is skipped, not titled with a blank",
       PAGES["wheat-futures-prices.html"][0](dict(ctx, prices=None)) is None)
    ck("a futures page with a price but no contract label is skipped",
       PAGES["wheat-futures-prices.html"][0](
           dict(ctx, prices={"quotes": {"wheat": {"close": 674.0}}})) is None)

    print("\nno field has two writers")
    # seed_static.py owns the meta description on the futures pages and rewrites
    # it with the day's close. If bake_seo ever claims desc on the same page the
    # two will disagree in public on some Tuesday. Assert they cannot overlap.
    import importlib.util as _ilu
    _sp = _ilu.spec_from_file_location("seed_static", REPO / "scripts" / "seed_static.py")
    try:
        _ss = _ilu.module_from_spec(_sp); _sp.loader.exec_module(_ss)
        theirs = set(getattr(_ss, "DESC", {}))
    except Exception as exc:                                  # noqa: BLE001
        theirs = set(FUTURES)                                 # assume the worst
        print(f"  (could not import seed_static: {exc}; assuming it owns {len(theirs)})")
    mine = {pg for pg, (_, owns) in PAGES.items() if "desc" in owns}
    ck("bake_seo writes no description seed_static also writes",
       not (mine & theirs), f"overlap: {sorted(mine & theirs)}")
    ck("every grain futures page is title-only here",
       all("desc" not in PAGES[p][1] for p in FUTURES))
    ck("cattle owns its description because nothing else writes one",
       "desc" in PAGES[CATTLE_PAGE][1] and CATTLE_PAGE not in theirs)

    def _cat(fetched, cd):
        q = {"close": 341.275, "close_date": cd, "netChange": 1.25, "prev_date": "2026-10-05"}
        return seo_cattle(dict(ctx, prices={"fetched": fetched, "quotes": {
            "cattle": {"close": 223.75, "close_date": cd, "netChange": -0.5,
                       "prev_date": "2026-10-05"}, "feeders": q}}))
    t_in, d_in = _cat("2026-10-06T16:50:00Z", "2026-10-06")
    # 2026-10-15: an in-session trade is no longer baked at all ("last traded
    # ... as of 11:50 a.m." stood in search after the close). The snippet
    # carries the previous close, named with its own day.
    ck("an in-session cattle quote is not baked; the previous close is, dated",
       "341.27" not in t_in + d_in and "$340.02" in d_in and "$224.25" in d_in
       and "on Oct 5." in d_in and "a.m." not in d_in, d_in)
    t_pm, d_pm = _cat("2026-10-06T20:35:00Z", "2026-10-06")
    ck("after the bell but before the settle is posted, the previous close is baked",
       "341.27" not in t_pm + d_pm and "$340.02" in d_pm and "on Oct 5." in d_pm, d_pm)
    t_cl, d_cl = _cat("2026-10-07T04:35:00Z", "2026-10-06")
    ck("a cattle quote fetched after 11 p.m. CT says settled, with its day",
       "Feeder cattle settled $341.27" in d_cl and "on Oct 6." in d_cl, d_cl)
    d_wk = _cat("2026-10-10T13:35:00Z", "2026-10-09")[1]
    ck("a Saturday run on Friday's quote says settled", "settled" in d_wk and "Oct 9" in d_wk, d_wk)
    ck("the cattle description never says closed", "closed" not in d_cl + d_wk, d_cl + d_wk)

    print("\nfutures titles and the board carry finished sessions only")
    from seed_static import settled_close
    # Oct 14 2026, 8:31 a.m. CT: Nov beans 1288.25, +4.5 on the Oct 13 close.
    beans_am = {"close": 1288.25, "netChange": 4.5, "pctChange": 0.35,
                "close_date": "2026-10-14", "prev_date": "2026-10-13"}
    am = {"fetched": "2026-10-14T13:31:00Z", "quotes": {"beans-nearby": beans_am},
          "nearby": {"beans": {"label": "Nov '26"}}}
    t_am = PAGES["soybean-futures-prices.html"][0](dict(ctx, prices=am))[0]
    ck("a morning run titles beans with the Oct 13 close, not the 8:31 trade",
       "$12.83" in t_am and "$12.88" not in t_am and "%" not in t_am, t_am)
    # Oct 15 03:16 UTC (10:16 p.m. CT Oct 14): the overnight session's trade
    # under the Oct 14 date. It is a trade, not a close.
    corn_night = {"close": 478.75, "netChange": -4.0, "close_date": "2026-10-14",
                  "prev_date": "2026-10-13"}
    ck("the grain overnight is not read as the day's close (nothing is baked)",
       settled_close(corn_night, "2026-10-15T03:16:15Z", "grain") is None)
    ck("...nor just after midnight, while the bar still carries Oct 14",
       settled_close(corn_night, "2026-10-15T05:20:00Z", "grain") is None)
    ck("a Sunday-evening overnight is not Friday's close",
       settled_close(dict(corn_night, close_date="2026-10-09", prev_date="2026-10-08"),
                     "2026-10-12T00:30:00Z", "grain") is None)
    # 2026-10-17: 3:35 p.m. CT is after the bell but before Yahoo swaps the
    # last trade for the settle. Dec corn's 481.00 that afternoon was a trade;
    # the Oct 14 settle was 480.75. The bake steps back to the Oct 13 settle.
    sc = settled_close(dict(corn_night, close=481.0, netChange=-1.75),
                       "2026-10-14T20:35:00Z", "grain")
    ck("after the bell, before the settle is posted, the last trade is not baked",
       sc and sc["px"] == 482.75 and sc["date"] == "2026-10-13" and sc["net"] is None, sc)
    sc = settled_close(dict(corn_night, close=474.25, netChange=-3.75, close_date="2026-10-16",
                            prev_date="2026-10-15"), "2026-10-17T05:00:00Z", "grain")
    ck("Friday's bar read after 11 p.m. CT (no evening session) is the settle",
       sc and sc["px"] == 474.25 and sc["date"] == "2026-10-16" and sc["net"] == -3.75, sc)
    # 2026-10-20 (Sig): the last daily bake moved from 23:35 to 04:50 UTC, after
    # the settle lands (about 04:15 UTC). Real files: at 00:46 UTC Dec corn's
    # file still held the Oct 16 settle (the day's 466.75 a last trade, the
    # evening trade 465.50 in last); at 04:46 UTC the Oct 19 settle 467.00 is
    # in and the price is the overnight trade 465.00. The title takes the
    # settle both times, never an overnight trade.
    _ovd = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "futures-overnight"
    _ov = {}
    for _n in ("0046Z", "0446Z"):
        try:
            with open(_ovd / f"prices-2026-10-20T{_n}.json") as _f:
                _ov[_n] = json.load(_f)
        except Exception as exc:
            _ov[_n] = None
            print(f"  (overnight fixture {_n} unreadable: {exc})")
    if _ov["0446Z"] and _ov["0046Z"]:
        _t5 = PAGES["corn-futures-prices.html"][0](dict(ctx, prices=_ov["0446Z"]))[0]
        ck("the 04:50 UTC run titles corn with the Oct 19 settle, not the overnight trade",
           "$4.67" in _t5 and "Oct 19" in _t5 and "4.65" not in _t5, _t5)
        _t0 = PAGES["corn-futures-prices.html"][0](dict(ctx, prices=_ov["0046Z"]))[0]
        ck("an evening run before the settle lands keeps the Oct 16 settle (why 23:35 was too early)",
           "Oct 16" in _t0 and "4.65" not in _t0 and "4.66" not in _t0, _t0)
    else:
        ck("overnight fixtures present (test/fixtures/futures-overnight)", False)
    # fetch_prices v3.7 files say what the close is; the bake reads the settle
    # fields and nothing else. Oct 16 2026, 1:46 p.m. CT: Nov beans last trade
    # 1260.50, the Oct 15 settle 1263.00 (-14.25 on Oct 14's 1277.25).
    v37 = {"close": 1260.5, "open": 1263.0, "netChange": -2.5, "close_date": "2026-10-16",
           "prev_date": "2026-10-15", "close_kind": "last", "close_time": "2026-10-16T18:20:00Z",
           "prev_kind": "settle", "settle": 1263.0, "settle_date": "2026-10-15", "settle_net": -14.25}
    sc = settled_close(v37, "2026-10-16T18:46:22Z", "grain")
    ck("v3.7 last trade: the bake carries the Oct 15 settle with its own change",
       sc and sc["px"] == 1263.0 and sc["date"] == "2026-10-15" and sc["net"] == -14.25, sc)
    v37s = dict(v37, close=1261.25, netChange=-1.75, close_kind="settle", settle=1261.25,
                settle_date="2026-10-16", settle_net=-1.75)
    v37s.pop("close_time")
    sc = settled_close(v37s, "2026-10-17T05:00:00Z", "grain")
    ck("v3.7 settle: settled $12.61 1/4, -1 3/4 on Oct 16 (the CBOT settle)",
       sc and sc["px"] == 1261.25 and sc["date"] == "2026-10-16" and sc["net"] == -1.75, sc)
    # 2026-10-20 03:31 UTC, real file: Dec corn last trade 466.75 (Oct 19),
    # newest settle 474.25 (Oct 16). The title says which day its number is.
    eve = {"fetched": "2026-10-20T03:31:20Z",
           "nearby": {"corn": {"key": "corn-dec26", "label": "Dec '26"},
                      "wheat": {"key": "wheat-dec26", "label": "Dec '26"}},
           "quotes": {"corn-nearby": {"close": 466.75, "close_date": "2026-10-19", "close_kind": "last",
                                      "settle": 474.25, "settle_date": "2026-10-16", "settle_net": -3.75},
                      "wheat-nearby": {"close": 656.0, "close_date": "2026-10-19", "close_kind": "last",
                                       "settle": 660.5, "settle_date": "2026-10-16", "settle_net": -2.0},
                      "cattle": {"close": 228.0, "close_date": "2026-10-19", "close_kind": "last",
                                 "settle": 227.55, "settle_date": "2026-10-16"},
                      "feeders": {"close": 344.0, "close_date": "2026-10-19", "close_kind": "last",
                                  "settle": 343.625, "settle_date": "2026-10-16"}}}
    t_eve = PAGES["corn-futures-prices.html"][0](dict(ctx, prices=eve))[0]
    ck("evening corn title names the settle's date, not just a number",
       t_eve == "CBOT Corn Futures Price: Dec '26 $4.74¼ (Oct 16) | AGSIST", t_eve)
    t_eve = PAGES["wheat-futures-prices.html"][0](dict(ctx, prices=eve))[0]
    ck("wheat title keeps its date within the cap",
       "(Oct 16)" in t_eve and "$6.60½" in t_eve and len(t_eve) <= TITLE_MAX, t_eve)
    t_eve = PAGES[CATTLE_PAGE][0](dict(ctx, prices=eve))[0]
    ck("cattle title names both settles and their date within the cap",
       t_eve.startswith("CME Feeder Cattle Futures $343.625 & Live Cattle $227.55 (Oct 16)")
       and len(t_eve) <= TITLE_MAX, t_eve)
    ck("v3.7 with no settle field bakes nothing",
       settled_close(dict(v37, settle=None), "2026-10-16T18:46:22Z", "grain") is None)
    t_nt = PAGES["soybean-futures-prices.html"][0](dict(ctx, prices={
        "fetched": "2026-10-16T18:46:22Z", "nearby": {"beans": {"label": "Nov '26"}},
        "quotes": {"beans-nearby": {"close": 1260.5, "netChange": -3.75, "close_date": "2026-10-16",
                                    "prev_date": "2026-10-15", "prev_source": "recorded settle"}}}))
    ck("a v3.6 file with no settle titles the page with no number",
       t_nt == ("CBOT Soybean Futures Price Today | AGSIST", None), t_nt)
    mk_nt = seo_markets(dict(ctx, today=date(2026, 10, 16), prices={
        "fetched": "2026-10-16T18:46:22Z",
        "quotes": {"corn": {"close": 474.25, "close_kind": "last", "close_date": "2026-10-16"}}}))
    ck("a board with no settle on file: markets title and description carry no number",
       mk_nt == MARKETS_PLAIN and not re.search(r"\d", mk_nt[0] + mk_nt[1].replace("15-minute", "")), mk_nt)
    ck("a v3.6 previous close taken from the afternoon trade is never baked",
       settled_close({"close": 1260.5, "netChange": -3.75, "close_date": "2026-10-16",
                      "prev_date": "2026-10-15", "prev_source": "recorded settle"},
                     "2026-10-16T18:46:22Z", "grain") is None)
    ck("no timing in the file means nothing is baked",
       settled_close({"close": 481.0}, "", "grain") is None)
    # Oct 15 03:16 UTC (10:16 p.m. CT Oct 14): Yahoo still carried the last
    # trade, 223.95. The settle, 223.90, arrived at the 04:01 UTC fetch. The
    # finished session at 03:16 UTC is Oct 13 (223.95 - (-0.725) = 224.675).
    lc_eve = {"close": 223.95, "close_date": "2026-10-14", "netChange": -0.725,
              "prev_date": "2026-10-13"}
    sc = settled_close(lc_eve, "2026-10-15T03:16:15Z", "cattle")
    ck("an evening cattle run does not call the last trade the close",
       sc and sc["px"] == 224.675 and sc["date"] == "2026-10-13" and sc["net"] is None, sc)
    sc = settled_close(dict(lc_eve, close=223.9), "2026-10-15T05:31:30Z", "cattle")
    ck("after 11 p.m. CT the cattle bar is the day's settle (legacy file)",
       sc and sc["px"] == 223.9 and sc["date"] == "2026-10-14", sc)
    mk = seo_markets(dict(ctx, today=date(2026, 10, 14), prices={
        "fetched": "2026-10-14T13:31:00Z",
        "quotes": {"corn": {"close": 481.25, "netChange": -1.5, "close_date": "2026-10-14",
                            "prev_date": "2026-10-13", "contract": "Dec '26"},
                   "beans": dict(beans_am, contract="Nov '26")}}))
    ck("a morning run dates the board by the last finished session",
       mk[0].startswith("CBOT Grain Prices Oct 13: Corn $4.82¾, Soybeans $12.83¾") and "%" not in mk[0] + mk[1],
       mk)

    print("\ndata pages: dated by the data, silent when it is old")
    t, d = seo_markets(ctx)
    ck("markets title carries the data's date and the corn price",
       t.startswith("CBOT Grain Prices Aug 14: Corn $4.59"), t)
    ck("markets title names CBOT, the word people search", t.startswith("CBOT "), t)
    ck("markets description says delayed, never live",
       "delayed" in d and "live" not in d.lower().replace("live cattle", ""), d)
    ck("the plain markets fallback says delayed, never live",
       "delayed" in MARKETS_PLAIN[1] and "live" not in (MARKETS_PLAIN[0] + MARKETS_PLAIN[1]).lower(), MARKETS_PLAIN)
    ck("markets description dates the quotes", "Aug 14, 2026" in d, d)
    ck("markets is skipped when the price file is a week old",
       seo_markets(dict(ctx, today=date(2026, 8, 24))) is None)
    mixed = dict(ctx, prices=dict(ctx["prices"], quotes=dict(
        ctx["prices"]["quotes"], cattle={"close": 223.75, "close_date": "2026-08-13"})))
    ck("a quote from another session is not printed under the board's date",
       "223.75" not in seo_markets(mixed)[1], seo_markets(mixed)[1])
    t, d = seo_basis(ctx)
    ck("basis counts the weak regions with the page's 10c band",
       "Weak in 2 of 3" in t, t)
    ck("basis leaves out a region USDA has not posted for weeks",
       "Ohio" not in d and "of 3 regions" in d, d)
    ck("basis description carries the USDA week", "Aug 14, 2026" in d, d)
    ck("basis is skipped when the newest week is a month old",
       seo_basis(dict(ctx, today=date(2026, 9, 20))) is None)
    ck("basis skipped with no file", seo_basis(dict(ctx, basis=None)) is None)
    # a held week: the table steps back to Aug 7 and the counts follow it, not the jumped week
    hb = {"weeks": {"Corn|Elevator Bid": {"week": "2026-08-07", "newest": "2026-08-14",
                                         "held": ["Corn|Kansas|Elevator Bid"]}},
          "series": {"Corn|Kansas|Elevator Bid": {"latest": -0.35, "date": "2026-08-07", "avg5": -0.30, "delta": -0.05},
                     "Corn|Iowa|Elevator Bid": {"latest": -0.43, "date": "2026-08-07", "avg5": -0.31, "delta": -0.12},
                     "Corn|Ohio|Elevator Bid": {"latest": -0.20, "date": "2026-08-07", "avg5": -0.33, "delta": 0.13},
                     "Corn|Indiana|Elevator Bid": {"latest": -1.0, "date": "2026-08-14", "avg5": -0.3, "delta": -0.7}}}
    t, d = seo_basis(dict(ctx, basis=hb))
    ck("a held week: counted in the table's week, tie reads mixed", "Mixed Across 3" in t, t)
    ck("a held week is named and Indiana's jumped week is not counted",
       "Aug 7, 2026" in d and "Aug 14 week is held" in d and "Indiana" not in d, d)
    t, d = seo_fertilizer(ctx)
    # the co-op posted price list (2026-10-15; was the hand-typed dealer sheet)
    ck("fertilizer title names this round's prices", "per Ton: Urea $623, Anhydrous $832" in t, t)
    ck("fertilizer title says whose prices they are (2026-10-16 audit)", t.startswith("Kansas Co-op Fertilizer"), t)
    ck("fertilizer description names the co-ops' region", d.startswith("Kansas co-op cash prices posted"), d)
    ck("fertilizer title carries NO date (weekly/monthly data)",
       not re.search(r"\b(20\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", t), t)
    ck("fertilizer description carries the posting dates of the prices it names",
       "posted Jul 28 to Aug 1, 2026" in d and "Aug 16" not in d, d)   # potash Jul 28, urea Aug 1
    rng = dict(ctx, fertilizer={"prices": [
        {"key": "urea", "price": 622.98, "as_of": "2026-09-24", "src": "coop", "region": "Kansas"},
        {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06", "src": "coop", "region": "Kansas"},
        {"key": "map", "price": 980.0, "as_of": "2026-10-12", "src": "coop", "region": "Kansas"}]},
        today=date(2026, 10, 16))
    t2, d2 = seo_fertilizer(rng)
    two = dict(rng, fertilizer={"prices": [
        {"key": "urea", "price": 615.95, "as_of": "2026-10-06", "src": "coop", "region": "Kansas and Wisconsin"},
        {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06", "src": "coop", "region": "Kansas"}]})
    t3, d3 = seo_fertilizer(two)
    ck("fertilizer: a two-state region names each state once (Synergy, WI, 2026-10-16)",
       t3.startswith("Kansas and Wisconsin Co-op Fertilizer") and "Kansas and Kansas" not in t3 + d3, (t3, d3))
    # night SEO audit, Oct 19, 2026: the real two-state case kept its number and lost "Prices"
    ck("fertilizer: one number cannot fit, so the title keeps the word Prices (Sig's Oct 13 wording)",
       t3 == "Kansas and Wisconsin Co-op Fertilizer Prices per Ton | AGSIST", t3)
    # 2026-10-17 audit N7: Wisconsin goes on the urea price only, never on Kansas-only anhydrous
    ck("fertilizer: the description names each price's own states",
       d3.startswith("Kansas co-op cash prices posted Oct 6, 2026: urea $616/ton (Kansas and Wisconsin), anhydrous $832.")
       and "anhydrous $832 (" not in d3, d3)
    one = dict(two, fertilizer={"prices": [two["fertilizer"]["prices"][0]]})
    t4, d4 = seo_fertilizer(one)
    ck("fertilizer: a title naming only urea names urea's states; the description needs no tag",
       t4.startswith("Kansas and Wisconsin Co-op Fertilizer") and d4.startswith("Kansas and Wisconsin co-op cash prices")
       and "(Kansas" not in d4, (t4, d4))
    ks = dict(two, fertilizer={"prices": [dict(two["fertilizer"]["prices"][1], key="urea"),
                                          dict(two["fertilizer"]["prices"][1])]})
    ck("fertilizer: Kansas-only prices put no Wisconsin in the title", seo_fertilizer(ks)[0].startswith("Kansas Co-op"),
       seo_fertilizer(ks)[0])
    ck("fertilizer: the date range is the named prices' own, not a product left out of them",
       "posted Sep 24 to Oct 6, 2026" in d2 and "Oct 12" not in d2, d2)
    old_in = dict(two, fertilizer={"prices": [
        {"key": "urea", "price": 615.95, "as_of": "2026-10-06", "oldest": "2026-09-24", "src": "coop", "region": "Kansas"},
        {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06", "oldest": "2026-10-06", "src": "coop", "region": "Kansas"}]})
    ck("fertilizer: a middle that took in a Sep 24 sheet is dated from Sep 24 (2026-10-16)",
       "posted Sep 24 to Oct 6, 2026" in seo_fertilizer(old_in)[1], seo_fertilizer(old_in)[1])
    ck("fertilizer: newest price 31 days old gives the plain title (30-day rule)",
       seo_fertilizer(dict(ctx, today=date(2026, 9, 1))) == FERT_PLAIN)
    ck("fertilizer: newest price 30 days old still names it", seo_fertilizer(dict(ctx, today=date(2026, 8, 31))) != FERT_PLAIN)
    ck("fertilizer leaves out a price from an older round", "650" not in t + d)
    # 2026-10-15: no longer skipped (a skip left the old priced title in place);
    # the plain title carries no number at all.
    ck("fertilizer: an old newest price gives the plain title, no number",
       seo_fertilizer(dict(ctx, today=date(2026, 12, 15))) == FERT_PLAIN and not re.search(r"\$\d", "".join(FERT_PLAIN)))
    ck("fertilizer: no file gives the plain title", seo_fertilizer(dict(ctx, fertilizer=None)) == FERT_PLAIN)

    print("\nmilk: the class month the file names, 50-60 characters, dropped when due")
    t, d = seo_milk(ctx)
    ck("milk title names the class month and the Class III price",
       t == "USDA Class III Milk Price July 2026: $17.50 | AGSIST", t)
    ck("milk description names both classes and the change",
       "July 2026 Class III at $17.50/cwt, down $0.12 from June, Class IV $18.04." in d, d)
    lens = [len(seo_milk(dict(ctx, today=date(2026, k + 2, 10),
                              dairy=dict(ctx["dairy"], class3=px,
                                         class_month_key=f"2026-{k + 1:02d}")))[0])
            for k in range(11) for px in (9.99, 29.99)]   # Jan-Nov 2026, priced the next month
    ck("every month and price keeps the milk title within 50-60 characters",
       all(50 <= n <= 60 for n in lens), str(sorted(set(lens))))
    ck("milk title and description carry no em dash", "\u2014" not in t + d)
    ck("on the 3rd the month before last is still current",
       seo_milk(dict(ctx, today=date(2026, 9, 3)))[0].startswith("USDA Class III Milk Price July"))
    ck("on the 6th it is due: back to the descriptive title, no stale number",
       seo_milk(dict(ctx, today=date(2026, 9, 6))) == (MILK_TITLE, MILK_DESC))
    ck("a class month in the future is not titled",
       seo_milk(dict(ctx, dairy=dict(ctx["dairy"], class_month_key="2026-09"))) == (MILK_TITLE, MILK_DESC))
    ck("a file with no Class III is not titled",
       seo_milk(dict(ctx, dairy=dict(ctx["dairy"], class3=None))) == (MILK_TITLE, MILK_DESC))
    ck("no dairy file: the page is left alone", seo_milk(dict(ctx, dairy=None)) is None)

    print("\nstamping")
    html = ('<title>Old</title>\n<meta name="description" content="old">\n'
            '<meta property="og:title" content="old">\n'
            '<meta property="og:description" content="old">\n'
            '<meta name="twitter:title" content="old">\n'
            '<meta name="twitter:description" content="old">')
    out, n = stamp(html, "New & Fresh", "Desc & more")
    ck("all six tags stamped", n == 6, str(n))
    _t, _n = stamp(html, "T", "D", frozenset({"title"}))
    ck("title-only ownership stamps 3 tags and leaves the descriptions alone",
       _n == 3 and 'content="old"' in _t, f"{_n} tags")
    aligned = ('<title>Old</title>\n<meta name="description"      content="old">\n'
               '<meta property="og:title"        content="old">\n'
               '<meta property="og:description"  content="old">\n'
               '<meta name="twitter:title"       content="old">\n'
               '<meta name="twitter:description" content="old">')
    ck("column-aligned attributes stamp too (the live markup)",
       stamp(aligned, "T", "D")[1] == EXPECT_TAGS, str(stamp(aligned, "T", "D")[1]))
    ck("ampersands escaped", out.count("&amp;") == 6, out)
    ck("idempotent", stamp(out, "New & Fresh", "Desc & more")[0] == out)

    print()
    if fails:
        print(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1
    print("all bake_seo checks pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--page", default=None)
    ap.add_argument("--today", default=None, help="YYYY-MM-DD, for tests")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    today = date.fromisoformat(a.today) if a.today else date.today()
    return run(today, dry=a.dry_run, only=a.page)


if __name__ == "__main__":
    sys.exit(main())
