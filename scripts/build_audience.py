#!/usr/bin/env python3
"""Who reads AGSIST, refreshed every morning: data/audience.json.

    python3 scripts/build_audience.py            # needs the secrets below
    python3 scripts/build_audience.py --selftest # no network

Every sponsor's portal draws its "Who reads AGSIST" dashboard from this one
file. It is site-wide, not per sponsor, and it holds nothing a forwarded link
could not show.

SOURCES AND SECRETS -- each one is optional and fails on its own
    GA4             GA4_PROPERTY_ID + GA4_SERVICE_ACCOUNT (Viewer on the property)
    Search Console  the same service account, added as a user on the property
    Bing Webmaster  BING_API_KEY
    Email list      LIST_URL + LIST_TOKEN (the subscriptions worker; only the
                    COUNT is kept -- no address is written anywhere)

A source that is not configured, or that fails, keeps what the previous file
held for it, with its own dates on it, and the run says so. A source is never
blanked because another one broke, and a number is never carried forward
without the dates that say how old it is.

US ONLY, AND THE SERVER TOWNS COME OUT FIRST

Every GA4 figure is filtered to the United States. Then, city by city over the
last 90 days, any town whose readers average under SERVER_SECONDS of
engagement across at least SERVER_MIN readers is treated as a server farm and
removed from EVERY GA4 query on the page -- totals, states, pages, devices,
channels, the daily series. Singapore averaged 2 seconds a "user" this year;
the US averaged 119. The towns removed, and how many "readers" each carried,
are written into the file and listed on the page, so the removal can be
checked rather than trusted.

Search Console is filtered to US searches. Bing's API has no country filter, so
Bing figures are worldwide and the file says so.

RETURNS AND THE RAIN PRINT FUNNEL

"returns" asks whether readers come back: GA4's new-vs-returning split (28 and
90 days) and weekly cohorts, the share of each week's new readers active again
on a later day within 14 days, withheld under COHORT_MIN new readers. GA4's
caveats (cookies, two devices, consent, blocking) are written into the file.
funnel_section() counts the events the Rain Print page sends, by week and for
the last 7 days: event names only, never a parameter. It is NOT written to
data/audience.json (the file is public; Sig, 2026-10-19): morning_report.py
calls it in its own job and the counts go only into Sig's email. Both use the
same US and server-town filter; returns fails on its own and keeps its last copy.
promo_section() is private the same way (2026-10-19): Rain Print and rain gauge
promo clicks by page, gauge waitlist signups, and email sessions by utm_source.

WHAT IT DOES NOT DO

It does not touch the AI-citation figures. Bing publishes those in its
dashboard and has no API for them; they come from an export
(scripts/audience_from_exports.py) and carry that export's dates.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "audience.json"
SCHEMA = "agsist-audience/2"

SERVER_SECONDS = 10     # average engagement per reader, seconds
SERVER_MIN = 20         # readers, over the 90-day window
HOME_STATE = "WI"       # AGSIST is run from Chetek; shown, not ranked
# Windows end LAG days ago. Measured on the first live run (2026-09-22, 11:39
# CT): yesterday came back with 256 users and ZERO engaged sessions -- GA4 had
# counted the visits and not yet processed the engagement -- and Search Console
# and Bing had no row for it at all. One day behind put a false cliff at the end
# of every chart and dragged the 7-day engagement rate from about 62% to 52%.
LAG = 2
UA = "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
}
METRICS = ["activeUsers", "engagedSessions", "userEngagementDuration", "sessions",
           "screenPageViews", "newUsers"]


def log(msg):
    print(msg, flush=True)


# ── the windows ───────────────────────────────────────────────────────────
def ranges(today):
    """Every window ends LAG days ago, on the last day all three sources have
    finished: a number that moves after a sponsor looked at it is worse than one
    a day older."""
    end = today - timedelta(days=LAG)
    jan1 = date(end.year, 1, 1)
    out = [("7d", "7 days", end - timedelta(days=6)),
           ("28d", "28 days", end - timedelta(days=27)),
           ("90d", "90 days", end - timedelta(days=89)),
           ("ytd", str(end.year), jan1)]
    return [{"id": i, "label": l, "start": s.isoformat(), "end": end.isoformat()} for i, l, s in out]


def series_start(today):
    """The daily series reaches back to Jan 1, or 90 days in January-March, so
    every range on the picker has its days."""
    end = today - timedelta(days=LAG)
    return min(date(end.year, 1, 1), end - timedelta(days=89))


# ── GA4 ───────────────────────────────────────────────────────────────────
class GA4:
    """A thin layer over the Data API so the selftest can swap the client.
    run() returns a list of dicts keyed by dimension and metric NAME -- the API
    adds a `dateRange` dimension when several ranges are asked for, and reading
    columns by position is how a report silently shifts one column over."""

    def __init__(self, prop, client):
        self.prop, self.client = prop, client

    def run(self, dims, metrics, date_ranges, filt=None, order=None, limit=100000):
        from google.analytics.data_v1beta.types import (
            DateRange, Dimension, Metric, OrderBy, RunReportRequest)
        req = RunReportRequest(
            property="properties/" + self.prop,
            dimensions=[Dimension(name=d) for d in dims],
            metrics=[Metric(name=m) for m in metrics],
            date_ranges=[DateRange(start_date=r["start"], end_date=r["end"], name=r["id"]) for r in date_ranges],
            dimension_filter=filt,
            order_bys=[OrderBy(metric=OrderBy.MetricOrderBy(metric_name=order), desc=True)] if order else [],
            limit=limit,
        )
        res = self.client.run_report(req)
        dh = [h.name for h in res.dimension_headers]
        mh = [h.name for h in res.metric_headers]
        out = []
        for r in res.rows:
            row = {n: v.value for n, v in zip(dh, r.dimension_values)}
            for n, v in zip(mh, r.metric_values):
                x = float(v.value)
                row[n] = int(x) if x.is_integer() else x
            out.append(row)
        return out


def f_us():
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name="country", string_filter=Filter.StringFilter(value="United States")))


def f_readers(servers):
    """US, minus every server town, matched on region AND city: a city name is
    not unique ("Ashburn" is in Virginia and in Georgia)."""
    from google.analytics.data_v1beta.types import Filter, FilterExpression, FilterExpressionList

    def eq(field, value):
        return FilterExpression(filter=Filter(field_name=field, string_filter=Filter.StringFilter(value=value)))
    if not servers:
        return f_us()
    towns = [FilterExpression(and_group=FilterExpressionList(expressions=[eq("region", s["region"]), eq("city", s["city"])]))
             for s in servers]
    return FilterExpression(and_group=FilterExpressionList(expressions=[
        f_us(),
        FilterExpression(not_expression=FilterExpression(or_group=FilterExpressionList(expressions=towns))),
    ]))


def f_and(*exprs):
    from google.analytics.data_v1beta.types import FilterExpression, FilterExpressionList
    return FilterExpression(and_group=FilterExpressionList(expressions=list(exprs)))


def f_in(field, values):
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name=field, in_list_filter=Filter.InListFilter(values=list(values))))


def f_begins(field, value):
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name=field, string_filter=Filter.StringFilter(
        value=value, match_type=Filter.StringFilter.MatchType.BEGINS_WITH)))


def summarise(rows):
    u = sum(r.get("activeUsers", 0) for r in rows)
    e = sum(r.get("engagedSessions", 0) for r in rows)
    s = sum(r.get("sessions", 0) for r in rows)
    t = sum(r.get("userEngagementDuration", 0) for r in rows)
    return {"users": u, "engaged": e, "sessions": s,
            "views": sum(r.get("screenPageViews", 0) for r in rows),
            "newUsers": sum(r.get("newUsers", 0) for r in rows),
            "avgSeconds": round(t / u, 1) if u else None,
            "engagementRate": round(e / s, 3) if s else None}


def by_range(rows):
    out = {}
    for r in rows:
        out.setdefault(r.get("dateRange", "only"), []).append(r)
    return out


def ga4_section(ga, rg, today):
    r90 = [x for x in rg if x["id"] == "90d"]
    # 1. find the server towns
    cities = ga.run(["region", "city"], ["activeUsers", "userEngagementDuration"], r90, filt=f_us())
    servers = []
    for c in cities:
        if c["city"] in ("(not set)", "") or c["activeUsers"] < SERVER_MIN:
            continue
        avg = c["userEngagementDuration"] / c["activeUsers"]
        if avg < SERVER_SECONDS:
            servers.append({"city": c["city"], "region": c["region"], "users": c["activeUsers"],
                            "avgSeconds": round(avg, 1)})
    servers.sort(key=lambda s: -s["users"])
    F = f_readers(servers)

    totals = {k: summarise(v) for k, v in by_range(ga.run([], METRICS, rg, filt=F)).items()}

    st = {}
    for k, v in by_range(ga.run(["region"], METRICS, rg, filt=F)).items():
        rows = []
        for r in v:
            if r["region"] not in STATES:
                continue
            x = summarise([r])
            x.update(code=STATES[r["region"]], name=r["region"])
            rows.append(x)
        rows.sort(key=lambda x: (-x["engaged"], -x["users"], x["code"]))
        n = 0
        for x in rows:
            if x["code"] == HOME_STATE:
                x["rank"], x["flag"] = None, "home"
            else:
                n += 1
                x["rank"] = n
        st[k] = rows

    start = series_start(today).isoformat()
    end = rg[0]["end"]
    daily = ga.run(["date"], ["activeUsers", "engagedSessions"], [{"id": "s", "start": start, "end": end}], filt=F)
    days = {}
    for r in daily:
        d = r["date"]
        days["%s-%s-%s" % (d[:4], d[4:6], d[6:])] = {"users": r["activeUsers"], "engaged": r["engagedSessions"]}

    # One call per window, so one window's rows can never crowd out the other's
    # under the row limit. Views only: views add across a page's titles, readers
    # do not (the same person reading two titles would count twice).
    pages = {}
    for win in [x for x in rg if x["id"] in ("28d", "90d")]:
        agg = {}
        for r in ga.run(["pagePath", "pageTitle"], ["screenPageViews"], [win], filt=F, order="screenPageViews", limit=400):
            p = r["pagePath"]
            a = agg.setdefault(p, {"path": p, "title": r["pageTitle"], "views": 0})
            a["views"] += r["screenPageViews"]
        k = win["id"]
        pages[k] = sorted(agg.values(), key=lambda x: -x["views"])[:15]
        for p in pages[k]:
            p["title"] = re.sub(r"\s*[|—-]\s*AGSIST\s*$", "", p["title"] or "").strip() or p["path"]

    devices = {k: {r["deviceCategory"]: r["activeUsers"] for r in v}
               for k, v in by_range(ga.run(["deviceCategory"], ["activeUsers"], rg, filt=F)).items()}
    channels = {k: sorted([{"channel": r["sessionDefaultChannelGroup"], "sessions": r["sessions"]} for r in v],
                          key=lambda x: -x["sessions"])
                for k, v in by_range(ga.run(["sessionDefaultChannelGroup"], ["sessions"], rg, filt=F)).items()}

    return {"totals": totals, "states": st, "gaDays": days, "pages": pages, "devices": devices,
            "channels": channels,
            "servers": {"rule": {"seconds": SERVER_SECONDS, "minReaders": SERVER_MIN},
                        "window": r90[0], "towns": servers,
                        "users": sum(s["users"] for s in servers)}}


# ── do readers come back? ─────────────────────────────────────────────────
# 13,004 of 13,241 US readers were "new" over 90 days (file of 2026-10-18).
# That is GA4's newUsers: browsers whose first visit fell in the window. It is
# not a return rate, and it cannot be one: a reader who came on day 1 and on
# day 40 is in both counts. This section asks the question directly.
#
#   newVsReturning  GA4's own split, users and sessions, 28 and 90 days. The
#                   user rows overlap (someone new on Monday who came back
#                   Thursday is in both), so they are never added up; the
#                   session rows do add up, and the share printed is of
#                   sessions.
#   cohorts         readers first seen in one Monday-to-Sunday week, and how
#                   many of them came back on a LATER day within 14 days of
#                   their own first day. Asked one first day at a time (date
#                   range d+1..d+14, firstSessionDate = d), so every reader is
#                   counted once and a reader who came back three times is
#                   still one. The days are disjoint, so a week is their sum.
#                   Only weeks whose last day is 14 days behind the window end
#                   are shown, and a week under COHORT_MIN new readers prints
#                   its reason instead of a share.
RETURN_DAYS = 14
COHORT_WEEKS = 8
COHORT_MIN = 100        # new readers in a week; under it, no share is printed
RETURNS_CAVEATS = [
    "GA4 counts browsers, not people. It knows a reader by a cookie: one person on a phone and a computer is two "
    "readers, and a cleared cookie or a new browser makes a returning reader look new.",
    "Safari and some other browsers expire a cookie set by a script after about 7 days without a visit, so a reader "
    "who comes back after a week can be counted as new. That pushes the return share DOWN, not up.",
    "Readers who send Global Privacy Control, who turned analytics off on /privacy, who block Google Analytics, or "
    "whose browser is automated are not counted at all, on any day.",
    "US only, with the same server towns removed as every other GA4 figure in this file. A reader who was in a "
    "server town, or outside the US, on their first day is not in a cohort.",
    "GA4 sends no row for a day with no returns; such a day counts as zero returns.",
    "These are estimates for watching a trend, not exact counts.",
]


def mondays(d):
    return d - timedelta(days=d.weekday())


def cohort_weeks(end, n=COHORT_WEEKS, days=RETURN_DAYS):
    """The n newest Monday-to-Sunday weeks whose last day is `days` or more
    behind `end`, oldest first, as (monday, sunday)."""
    last = end - timedelta(days=days)
    sun = last - timedelta(days=(last.weekday() + 1) % 7)
    return [(sun - timedelta(days=6 + 7 * i), sun - timedelta(days=7 * i)) for i in range(n - 1, -1, -1)]


def ymd(d):
    return d.strftime("%Y%m%d")


def cohort_rows(weeks, sizes, back, min_n=COHORT_MIN):
    """sizes / back: {YYYYMMDD: readers}. A day missing from sizes had no new
    readers; missing from back, no returns. Returns one row per week."""
    out = []
    for mon, sun in weeks:
        days = [ymd(mon + timedelta(days=i)) for i in range(7)]
        n = sum(sizes.get(d, 0) for d in days)
        k = sum(back.get(d, 0) for d in days)
        row = {"week": mon.isoformat(), "end": sun.isoformat(), "newReaders": n, "returned": k}
        if n < min_n:
            row.update(share=None, withheld="%d new readers that week, under the %d needed to print a share" % (n, min_n))
        else:
            row.update(share=round(k / n, 3), withheld=None)
        out.append(row)
    return out


def returns_section(ga, F, rg):
    end = date.fromisoformat(rg[0]["end"])
    nvr = {}
    for k, v in by_range(ga.run(["newVsReturning"], ["activeUsers", "sessions", "engagedSessions"],
                                [x for x in rg if x["id"] in ("28d", "90d")], filt=F)).items():
        rows = {}
        for r in v:
            key = r["newVsReturning"] if r["newVsReturning"] in ("new", "returning") else "not set"
            a = rows.setdefault(key, {"users": 0, "sessions": 0, "engaged": 0})
            a["users"] += r["activeUsers"]
            a["sessions"] += r["sessions"]
            a["engaged"] += r["engagedSessions"]
        s = sum(x["sessions"] for x in rows.values())
        nvr[k] = {"rows": rows, "sessions": s,
                  "returningSessionShare": round(rows.get("returning", {}).get("sessions", 0) / s, 3) if s else None}

    weeks = cohort_weeks(end)
    days = [weeks[0][0] + timedelta(days=i) for i in range((weeks[-1][1] - weeks[0][0]).days + 1)]
    sizes = {}
    for r in ga.run(["firstSessionDate"], ["activeUsers"],
                    [{"id": "c", "start": days[0].isoformat(), "end": days[-1].isoformat()}],
                    filt=f_and(F, f_in("firstSessionDate", [ymd(d) for d in days]))):
        sizes[r["firstSessionDate"]] = sizes.get(r["firstSessionDate"], 0) + r["activeUsers"]
    back = {}
    for i in range(0, len(days), 4):        # the Data API takes at most four date ranges a request
        chunk = days[i:i + 4]
        drs = [{"id": "d" + ymd(d), "start": (d + timedelta(days=1)).isoformat(),
                "end": (d + timedelta(days=RETURN_DAYS)).isoformat()} for d in chunk]
        for r in ga.run(["firstSessionDate"], ["activeUsers"], drs, filt=f_and(F, f_in("firstSessionDate", [ymd(d) for d in chunk]))):
            if r.get("dateRange", drs[0]["id"]) == "d" + r["firstSessionDate"]:
                back[r["firstSessionDate"]] = back.get(r["firstSessionDate"], 0) + r["activeUsers"]
    return {"through": end.isoformat(), "newVsReturning": nvr,
            "cohorts": {"rule": {"returnDays": RETURN_DAYS, "minNewReaders": COHORT_MIN, "week": "Monday to Sunday",
                                 "returned": "active again on a later day, within %d days of their own first day" % RETURN_DAYS},
                        "weeks": cohort_rows(weeks, sizes, back)},
            "caveats": RETURNS_CAVEATS}


# ── the Rain Print funnel ─────────────────────────────────────────────────
# NOT written to data/audience.json, which is public (Sig, 2026-10-19: no
# Rain Print numbers in a committed file until he decides). morning_report.py
# calls funnel_section() in its own job; the counts go only into his email.
# Event names only, counted on /rain-print* pages. No event parameter is read:
# the design code, the Stripe session and the town never leave GA4. The events
# are the ones components/rain-print.js and components/signup-ask.js send.
# rain_print_buy and rain_print_order carry a via / result parameter that GA4
# can only split once it is registered as a custom dimension; until then a
# "Pay" press counts Stripe and the order form together, and an order-form
# send counts sent and failed together.
FUNNEL = [
    ("rain_print_draw", "draws", "a print drawn for a town and year (every redraw counts)"),
    ("rain_print_step3", "pay button seen", "the pay button came on screen, once a visit"),
    ("rain_print_proof", "review opened", "the review sheet opened (the order button, or tapping the print)"),
    ("rain_print_buy", "pay pressed", "Pay pressed on the review sheet: to Stripe checkout or to the order form"),
    ("rain_print_order", "order form sent", "the order request form submitted (sent or failed)"),
    ("purchase", "paid, back from Stripe", "back on the page from a paid Stripe checkout, once per order per browser"),
    ("email_signup", "email signups", "a Daily signup made on a Rain Print page"),
]
FUNNEL_WEEKS = 8
FUNNEL_PATH = "/rain-print"
FUNNEL_CAVEATS = [
    "GA4 events, counted by GA4, with the same US-only and server-town rules as the rest of this file.",
    "A paid order counts only if the buyer came back to the page from Stripe; Stripe itself is the record of what was paid.",
    "A week with no row for an event counts as zero; a zero can also mean the page did not send that event yet.",
]


def funnel_section(ga, F, rg):
    end = date.fromisoformat(rg[0]["end"])
    last_sun = end - timedelta(days=(end.weekday() + 1) % 7)
    weeks = [(last_sun - timedelta(days=6 + 7 * i), last_sun - timedelta(days=7 * i)) for i in range(FUNNEL_WEEKS - 1, -1, -1)]
    names = [e for e, _, _ in FUNNEL]
    filt = f_and(F, f_in("eventName", names), f_begins("pagePath", FUNNEL_PATH))
    counts = {}
    for r in ga.run(["date", "eventName"], ["eventCount"],
                    [{"id": "w", "start": weeks[0][0].isoformat(), "end": end.isoformat()}], filt=filt):
        d = date(int(r["date"][:4]), int(r["date"][4:6]), int(r["date"][6:]))
        counts[(mondays(d), r["eventName"])] = counts.get((mondays(d), r["eventName"]), 0) + r["eventCount"]
    wk = [{"week": m.isoformat(), "end": s.isoformat(), "counts": {e: counts.get((m, e), 0) for e in names}}
          for m, s in weeks]
    r7 = [x for x in rg if x["id"] == "7d"][0]
    got = {r["eventName"]: r for r in ga.run(["eventName"], ["eventCount", "totalUsers"], [r7], filt=filt)}
    last7 = {"start": r7["start"], "end": r7["end"],
             "counts": {e: got[e]["eventCount"] if e in got else 0 for e in names},
             "people": {e: got[e]["totalUsers"] if e in got else 0 for e in names}}
    return {"through": end.isoformat(), "pages": FUNNEL_PATH + "*",
            "events": [{"event": e, "label": l, "means": m} for e, l, m in FUNNEL],
            "weeks": wk, "last7": last7, "stripe": None,
            "stripeNote": "No Stripe source runs in this job; the morning report reads paid orders from Stripe once STRIPE_READ_KEY is set.",
            "caveats": FUNNEL_CAVEATS}


# ── promo clicks, gauge signups, email sessions (private, 2026-10-19) ─────
# Same rule as the funnel: NOT written to data/audience.json. morning_report.py
# calls promo_section() in its own job and the counts go only into Sig's email.
# The funnel above counts /rain-print* pages only, so a promo click on any other
# page and a gauge waitlist signup were never reported (board, Oct 19).
#   - rain_print_promo_click / rain_gauge_promo_click: counted by the page they
#     were clicked on (pagePath: the path only, no query string).
#   - gauge waitlist signups: notice_signup on /rain-gauge pages. The topic is an
#     event parameter GA4 cannot split until it is registered as a custom
#     dimension, so the page stands in for it: rain-gauge.html is the only page
#     that sends notice_signup with topic rain-gauge. The worker's own list
#     count (morning_report.py, /notice-list?topic=rain-gauge) is the record.
#   - email sessions by utm_source (sessionMedium "email"): the Daily is
#     "daily" since Oct 19 ("daily_email" before), the others their own
#     sources; the Daily's split by utm_content (which link) too.
# Counts only: no event parameter, no full URL, nothing about a reader.
PROMO_EVENTS = ["rain_print_promo_click", "rain_gauge_promo_click"]
GAUGE_SIGNUP = ("notice_signup", "/rain-gauge")
DAILY_SOURCES = ("daily", "daily_email")
PROMO_TOP = 8
PROMO_CAVEATS = [
    "GA4 events and sessions, with the same US-only and server-town rules as the rest of this file. GA is off for readers with Global Privacy Control.",
    "Gauge waitlist signups are notice_signup events on /rain-gauge pages; the worker's list count is the record.",
    "Email sessions are sessions whose medium is email, by utm_source. Before Oct 19 only the Daily's button was tagged; its other links landed as Direct.",
]


def f_eq(field, value):
    from google.analytics.data_v1beta.types import Filter, FilterExpression
    return FilterExpression(filter=Filter(field_name=field, string_filter=Filter.StringFilter(value=value)))


def promo_section(ga, F, rg):
    """{windows: {7d, 28d: {start, end, promos, gaugeSignups, email}}, ...}.
    promos[event] = {"total": n, "pages": [{"page", "count"}] top PROMO_TOP};
    email = {"bySource": [{"source", "sessions", "engaged"}], "daily": [{"content", "sessions"}]}."""
    wins = [x for x in rg if x["id"] in ("7d", "28d")]
    out = {"through": wins[0]["end"], "windows": {}, "caveats": PROMO_CAVEATS}
    for w in wins:
        out["windows"][w["id"]] = {"start": w["start"], "end": w["end"],
                                   "promos": {e: {"total": 0, "pages": []} for e in PROMO_EVENTS},
                                   "gaugeSignups": 0, "email": {"bySource": [], "daily": []}}
    multi = len(wins) > 1
    wid = lambda r: r.get("dateRange") if multi else wins[0]["id"]
    ev = ga.run(["eventName", "pagePath"], ["eventCount"], wins,
                filt=f_and(F, f_in("eventName", PROMO_EVENTS + [GAUGE_SIGNUP[0]])))
    pages = {}
    for r in ev:
        k, e, pg, n = wid(r), r.get("eventName"), r.get("pagePath") or "(not set)", r.get("eventCount", 0)
        if k not in out["windows"]:
            continue
        if e == GAUGE_SIGNUP[0]:
            if pg.startswith(GAUGE_SIGNUP[1]):
                out["windows"][k]["gaugeSignups"] += n
            continue
        if e in PROMO_EVENTS:
            pages.setdefault((k, e), {})
            pages[(k, e)][pg] = pages[(k, e)].get(pg, 0) + n
    for (k, e), m in pages.items():
        rows = sorted(m.items(), key=lambda x: (-x[1], x[0]))
        out["windows"][k]["promos"][e] = {"total": sum(m.values()),
                                          "pages": [{"page": p, "count": n} for p, n in rows[:PROMO_TOP]]}
    em = ga.run(["sessionSource", "sessionManualAdContent"], ["sessions", "engagedSessions"], wins,
                filt=f_and(F, f_eq("sessionMedium", "email")))
    src, cont = {}, {}
    for r in em:
        k = wid(r)
        if k not in out["windows"]:
            continue
        so, c = r.get("sessionSource") or "(not set)", r.get("sessionManualAdContent") or "(not set)"
        a_ = src.setdefault(k, {}).setdefault(so, [0, 0])
        a_[0] += r.get("sessions", 0)
        a_[1] += r.get("engagedSessions", 0)
        if so in DAILY_SOURCES:
            cont.setdefault(k, {})
            cont[k][c] = cont[k].get(c, 0) + r.get("sessions", 0)
    for k, m in src.items():
        out["windows"][k]["email"]["bySource"] = [{"source": so, "sessions": v[0], "engaged": v[1]}
                                                  for so, v in sorted(m.items(), key=lambda x: (-x[1][0], x[0]))]
    for k, m in cont.items():
        out["windows"][k]["email"]["daily"] = [{"content": c, "sessions": n}
                                               for c, n in sorted(m.items(), key=lambda x: (-x[1], x[0]))]
    return out


# ── Search Console ────────────────────────────────────────────────────────
def is_ours(u):
    u = (u or "").lower()
    return u in ("sc-domain:agsist.com",) or re.match(r"^https?://(www\.)?agsist\.com/?$", u) is not None


def gsc_section(session, rg, today):
    base = "https://www.googleapis.com/webmasters/v3/sites"
    def call(method, url, **kw):
        r = getattr(session, method)(url, timeout=60, **kw)
        r.raise_for_status()      # a 403 or 429 must fail this source, not look like an empty month
        return r.json()
    sites = call("get", base).get("siteEntry") or []
    mine = [s["siteUrl"] for s in sites if is_ours(s.get("siteUrl", ""))]
    if not mine:
        raise RuntimeError("the service account can see %d Search Console properties and none is agsist.com -- "
                           "add it as a user on the property" % len(sites))
    site = sorted(mine, key=lambda u: not u.startswith("sc-domain:"))[0]
    url = base + "/" + urllib.parse.quote(site, safe="") + "/searchAnalytics/query"
    us = [{"filters": [{"dimension": "country", "operator": "equals", "expression": "usa"}]}]
    start, end = series_start(today).isoformat(), rg[0]["end"]
    daily = call("post", url, json={"startDate": start, "endDate": end, "dimensions": ["date"],
                                    "dimensionFilterGroups": us, "rowLimit": 25000}).get("rows") or []
    days = {r["keys"][0]: {"clicks": int(r["clicks"]), "impr": int(r["impressions"])} for r in daily}
    r28 = [x for x in rg if x["id"] == "28d"][0]
    q = call("post", url, json={"startDate": r28["start"], "endDate": r28["end"], "dimensions": ["query"],
                                "dimensionFilterGroups": us, "rowLimit": 20}).get("rows") or []
    queries = [{"q": r["keys"][0], "clicks": int(r["clicks"]), "impr": int(r["impressions"]),
                "pos": round(r["position"], 1)} for r in q]
    return {"site": site, "days": days, "queries": {"start": r28["start"], "end": r28["end"], "rows": queries}}


# ── Bing ──────────────────────────────────────────────────────────────────
def bing_date(s):
    m = re.search(r"/Date\((-?\d+)", str(s))
    return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc).date() if m else None


def bing_section(get, rg, today):
    sites = get("GetUserSites", {}).get("d") or []
    mine = [s.get("Url") for s in sites if is_ours(s.get("Url"))]
    if not mine:
        raise RuntimeError("the Bing key sees %d sites and none is agsist.com" % len(sites))
    site = sorted(mine, key=lambda u: not u.startswith("https://"))[0]
    days = {}
    for r in get("GetRankAndTrafficStats", {"siteUrl": site}).get("d") or []:
        d = bing_date(r.get("Date"))
        if d:
            days[d.isoformat()] = {"clicks": int(r.get("Clicks") or 0), "impr": int(r.get("Impressions") or 0)}
    # Query stats come back in weekly buckets. The last four buckets are used,
    # and the window printed is the buckets' own dates, not "28 days".
    qs = get("GetQueryStats", {"siteUrl": site}).get("d") or []
    # The bucket width is MEASURED from the gaps between dates rather than
    # assumed to be a week; the window then covers about 28 days of buckets.
    allb = sorted({bing_date(r.get("Date")) for r in qs if bing_date(r.get("Date"))})
    gaps = [(b - a).days for a, b in zip(allb, allb[1:]) if (b - a).days > 0]
    width = min(gaps) if gaps else 7
    weeks = [b for b in allb if allb and b > allb[-1] - timedelta(days=28 - width + 1)] if allb else []
    agg = {}
    for r in qs:
        if bing_date(r.get("Date")) not in weeks:
            continue
        a = agg.setdefault(r.get("Query"), {"q": r.get("Query"), "clicks": 0, "impr": 0})
        a["clicks"] += int(r.get("Clicks") or 0)
        a["impr"] += int(r.get("Impressions") or 0)
    rows = sorted(agg.values(), key=lambda x: (-x["clicks"], -x["impr"]))[:20]
    q = ({"start": weeks[0].isoformat(), "end": min(weeks[-1] + timedelta(days=width - 1), today - timedelta(days=LAG)).isoformat(),
          "rows": rows} if weeks else None)
    return {"site": site, "days": days, "queries": q}


# ── email ─────────────────────────────────────────────────────────────────
def email_count(base, token, fetch=None):
    u = base.rstrip("/") + "/list?token=" + urllib.parse.quote(token)
    if fetch is None:
        def fetch(url):
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
                return r.read().decode()
    body = fetch(u)
    return len({x.strip().lower() for x in re.split(r"[,\n]", body) if "@" in x})


# ── assembly ──────────────────────────────────────────────────────────────
def merge_series(ga_days, g_days, b_days, start, end):
    out, d = [], date.fromisoformat(start)
    while d <= date.fromisoformat(end):
        k = d.isoformat()
        a, g, b = (ga_days or {}).get(k), (g_days or {}).get(k), (b_days or {}).get(k)
        out.append({"d": k,
                    "users": a["users"] if a else None, "engaged": a["engaged"] if a else None,
                    "gClicks": g["clicks"] if g else None, "gImpr": g["impr"] if g else None,
                    "bClicks": b["clicks"] if b else None, "bImpr": b["impr"] if b else None})
        d += timedelta(days=1)
    return out


def build(today, prev, ga=None, gsc=None, bing=None, email=None, errors=None, returns=None):
    """prev: the previous file (or {}). ga/gsc/bing/returns: section dicts
    or None when that source was not available this run. Anything None is
    carried from prev, with its own "through" date on it."""
    rg = ranges(today)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    src = dict(prev.get("sources") or {})
    out = {"schema": SCHEMA, "built": now, "ranges": rg, "homeState": HOME_STATE}

    if ga:
        out.update({k: ga[k] for k in ("totals", "states", "pages", "devices", "channels", "servers")})
        src["ga4"] = {"ok": True, "through": rg[0]["end"], "fetched": now}
    else:
        for k in ("totals", "states", "pages", "devices", "channels", "servers",
                  "mode", "stateFlagRule", "stateWindow", "leftOut"):
            if k in prev:
                out[k] = prev[k]
        if prev.get("schema") == SCHEMA:
            out["ranges"] = prev.get("ranges", rg)   # the carried numbers keep the windows they were cut on
        src.setdefault("ga4", {"ok": False})
        src["ga4"] = dict(src["ga4"], ok=False, error=(errors or {}).get("ga4", "not configured"))

    prev_days = {r["d"]: r for r in (prev.get("series") or {}).get("days", [])}

    def carry(key, fresh):
        if fresh is not None:
            return fresh
        return {d: {"clicks": r.get(key[0] + "Clicks"), "impr": r.get(key[0] + "Impr")}
                for d, r in prev_days.items() if r.get(key[0] + "Clicks") is not None} or None

    ga_days = ga["gaDays"] if ga else ({d: {"users": r["users"], "engaged": r["engaged"]}
                                        for d, r in prev_days.items() if r.get("users") is not None} or None)
    g_days = carry("g", gsc["days"] if gsc else None)
    b_days = carry("b", bing["days"] if bing else None)
    if ga_days or g_days or b_days:
        s_end = rg[0]["end"]      # fresh search days are kept even while GA4 is failing
        s_start = series_start(date.fromisoformat(s_end) + timedelta(days=LAG)).isoformat()
        out["series"] = {"start": s_start, "end": s_end,
                         "days": merge_series(ga_days, g_days, b_days, s_start, s_end)}

    q = dict(prev.get("queries") or {})
    if gsc:
        q["google"] = dict(gsc["queries"], country="US")
        src["gsc"] = {"ok": True, "site": gsc["site"], "fetched": now}
    else:
        src["gsc"] = dict(src.get("gsc") or {}, ok=False, error=(errors or {}).get("gsc", "not configured"))
    if bing:
        if bing.get("queries"):
            q["bing"] = dict(bing["queries"], country="worldwide")
        src["bing"] = {"ok": True, "site": bing["site"], "fetched": now}
    else:
        src["bing"] = dict(src.get("bing") or {}, ok=False, error=(errors or {}).get("bing", "not configured"))
    if q:
        out["queries"] = q

    if email is not None:
        out["email"] = {"subscribers": email, "asOf": today.isoformat()}
        src["email"] = {"ok": True, "fetched": now}
    else:
        if prev.get("email"):
            out["email"] = prev["email"]
        src["email"] = dict(src.get("email") or {}, ok=False, error=(errors or {}).get("email", "not configured"))

    if returns is not None:
        out["returns"] = returns
        src["returns"] = {"ok": True, "through": returns["through"], "fetched": now}
    else:
        if "returns" in prev:
            out["returns"] = prev["returns"]
        src["returns"] = dict(src.get("returns") or {}, ok=False, error=(errors or {}).get("returns", "not configured"))
    src.pop("rain_print_funnel", None)      # never in this public file
    src.pop("promos", None)                 # nor the promo and email-session counts

    # Carried from the exports, with their own dates, until Bing has an API for them.
    if "ai" in prev:
        out["ai"] = prev["ai"]
    ss = dict(prev.get("searchStatic") or {})
    if gsc:
        ss.pop("google", None)
    if bing:
        ss.pop("bing", None)
    if ss:
        out["searchStatic"] = ss
    out["sources"] = src
    return out


def main():
    today = date.today()
    try:
        prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    except ValueError:
        prev = {}
    errors = {}
    extra = {}
    ga = gsc = bing = email = None
    prop = os.environ.get("GA4_PROPERTY_ID", "").strip()
    cred = os.environ.get("GA4_SERVICE_ACCOUNT", "").strip()
    info = None
    if cred:
        try:
            info = json.loads(cred)
        except ValueError:
            errors["ga4"] = errors["gsc"] = "GA4_SERVICE_ACCOUNT is not the whole JSON key file"
    rg = ranges(today)

    if prop and info:
        try:
            from google.analytics.data_v1beta import BetaAnalyticsDataClient
            from google.oauth2 import service_account
            c = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/analytics.readonly"])
            ga = ga4_section(GA4(prop, BetaAnalyticsDataClient(credentials=c)), rg, today)
            log("GA4: %s US readers in 28 days after removing %d server town(s) carrying %d"
                % (ga["totals"]["28d"]["users"], len(ga["servers"]["towns"]), ga["servers"]["users"]))
        except Exception as e:  # noqa: BLE001 -- one source failing must not take the others down
            errors["ga4"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::GA4 failed, keeping the previous figures: " + errors["ga4"])
        if ga:
            # Each on its own: a refused cohort request must not cost the totals.
            # The Rain Print funnel is not pulled here: it never goes in this public file.
            try:
                extra["returns"] = returns_section(GA4(prop, BetaAnalyticsDataClient(credentials=c)),
                                                   f_readers(ga["servers"]["towns"]), rg)
                w = [x for x in extra["returns"]["cohorts"]["weeks"] if x["share"] is not None]
                log("returns: %d of %d cohort weeks printable" % (len(w), len(extra["returns"]["cohorts"]["weeks"])))
            except Exception as e:  # noqa: BLE001
                errors["returns"] = "%s: %s" % (type(e).__name__, str(e)[:300])
                log("::warning::returns failed, keeping the previous figures: " + errors["returns"])
        else:
            errors.setdefault("returns", "not pulled: the main GA4 pull failed")
    if info:
        try:
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account
            c = service_account.Credentials.from_service_account_info(
                info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
            gsc = gsc_section(AuthorizedSession(c), rg, today)
            log("Search Console: %s, %d days, %d queries" % (gsc["site"], len(gsc["days"]), len(gsc["queries"]["rows"])))
        except Exception as e:  # noqa: BLE001
            errors["gsc"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::Search Console failed, keeping the previous figures: " + errors["gsc"])
    key = os.environ.get("BING_API_KEY", "").strip()
    if key:
        def get(method, params):
            q = dict(params, apikey=key)
            u = "https://ssl.bing.com/webmaster/api.svc/json/%s?%s" % (method, urllib.parse.urlencode(q))
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as r:
                return json.loads(r.read().decode())
        try:
            bing = bing_section(get, rg, today)
            log("Bing: %s, %d days" % (bing["site"], len(bing["days"])))
        except Exception as e:  # noqa: BLE001
            errors["bing"] = "%s: %s" % (type(e).__name__, str(e)[:300])
            log("::warning::Bing failed, keeping the previous figures: " + errors["bing"])
    lu, lt = os.environ.get("LIST_URL", "").strip(), os.environ.get("LIST_TOKEN", "").strip()
    if lu and lt:
        try:
            email = email_count(lu, lt)
            log("email: %d subscribers" % email)
        except Exception as e:  # noqa: BLE001
            errors["email"] = "%s: %s" % (type(e).__name__, str(e)[:200])
            log("::warning::subscriber count failed: " + errors["email"])

    if not any((ga, gsc, bing, email is not None)):
        log("::warning::no source was reachable or configured -- data/audience.json left exactly as it was")
        return 0
    out = build(today, prev, ga, gsc, bing, email, errors, returns=extra.get("returns"))
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    log("wrote data/audience.json")
    return 0


# ── selftest ──────────────────────────────────────────────────────────────
def selftest():
    ok = True

    def t(c, name):
        nonlocal ok
        print(("  ok    " if c else "  FAIL  ") + name)
        ok = ok and bool(c)

    today = date(2026, 9, 24)
    rg = ranges(today)
    t(all(r["end"] == "2026-09-22" for r in rg), "every window ends LAG days back, on the last finished day")
    t(rg[0]["start"] == "2026-09-16" and rg[3]["start"] == "2026-01-01", "7 days is seven days; the year starts Jan 1")
    t(series_start(date(2026, 2, 1)) == date(2025, 11, 2), "in January the series still covers 90 days")

    # A fake GA4 client that answers from a table and records every request.
    class V:
        def __init__(self, v):
            self.value = v

    class H:
        def __init__(self, n):
            self.name = n

    class Res:
        def __init__(self, dims, mets, rows):
            self.dimension_headers = [H(d) for d in dims]
            self.metric_headers = [H(m) for m in mets]
            self.rows = [type("R", (), {"dimension_values": [V(str(x)) for x in r[:len(dims)]],
                                        "metric_values": [V(str(x)) for x in r[len(dims):]]}) for r in rows]
    seen = []

    class Client:
        def run_report(self, req):
            seen.append(req)
            dims = [d.name for d in req.dimensions]
            mets = [m.name for m in req.metrics]
            multi = len(req.date_ranges) > 1
            if dims == ["region", "city"]:
                return Res(dims, mets, [["Virginia", "Ashburn", 600, 600], ["Georgia", "Ashburn", 25, 2500],
                                        ["Iowa", "Des Moines", 120, 16000], ["Iowa", "Council Bluffs", 40, 120],
                                        ["Ohio", "Tiny", 5, 1]])
            H_ = dims + (["dateRange"] if multi else [])
            rows = []
            for r in req.date_ranges:
                tag = [r.name] if multi else []
                vals = {m: 10 for m in mets}
                if dims == []:
                    rows.append(tag + [vals[m] for m in mets])
                elif dims == ["region"]:
                    for reg, e in (("Iowa", 50), ("Wisconsin", 90), ("Texas", 30), ("Tbilisi", 99)):
                        rows.append([reg] + tag + [e if m == "engagedSessions" else 10 for m in mets])
                elif dims == ["date"]:
                    rows.append(["20260922", 11, 7])
                elif dims == ["pagePath", "pageTitle"]:
                    rows.append(["/cash-bids", "Local Cash Grain Bids Today | AGSIST"] + tag + ["4e1"])
                    rows.append(["/cash-bids", "Old title | AGSIST"] + tag + [5])
                elif dims == ["deviceCategory"]:
                    rows.append(["mobile"] + tag + [7]); rows.append(["desktop"] + tag + [3])
                elif dims == ["sessionDefaultChannelGroup"]:
                    rows.append(["Organic Search"] + tag + [9])
            # the API puts dateRange LAST among the dimensions; rows above put it after the real dims
            return Res(H_, mets, rows)

    g = ga4_section(GA4("123", Client()), rg, today)
    towns = {(s["region"], s["city"]) for s in g["servers"]["towns"]}
    t(("Virginia", "Ashburn") in towns and ("Iowa", "Council Bluffs") in towns, "towns averaging under the rule are removed")
    t(("Georgia", "Ashburn") not in towns, "a real town sharing a server town's name is kept -- matched on state AND city")
    t(("Ohio", "Tiny") not in towns, "a town under the minimum readers is never judged")
    t(g["servers"]["users"] == 640, "the removed readers are counted and published")
    later = [r for r in seen if [d.name for d in r.dimensions] != ["region", "city"]]
    t(all("Ashburn" in str(r.dimension_filter) for r in later), "every later GA4 query excludes the server towns")
    t(all("United States" in str(r.dimension_filter) for r in seen), "every GA4 query is US only")
    t(set(g["totals"]) == {"7d", "28d", "90d", "ytd"}, "totals exist for every range")
    st = {x["code"]: x for x in g["states"]["28d"]}
    t(set(st) == {"IA", "WI", "TX"}, "only US states become rows")
    t(st["WI"]["rank"] is None and st["IA"]["rank"] == 1 and st["TX"]["rank"] == 2, "home state unranked, others 1..n by engaged")
    t(g["pages"]["28d"][0]["views"] == 45 and g["pages"]["28d"][0]["title"] == "Local Cash Grain Bids Today"
      and "users" not in g["pages"]["28d"][0],
      "a page's views are summed across its titles, and the site suffix is dropped")
    t(g["devices"]["7d"] == {"mobile": 7, "desktop": 3}, "devices per range")
    t(g["gaDays"] == {"2026-09-22": {"users": 11, "engaged": 7}}, "daily series keyed by ISO date")

    # Search Console
    class Sess:
        def __init__(self):
            self.bodies = []

        def get(self, url, timeout=None):
            return type("J", (), {"raise_for_status": lambda s: None, "json": lambda s: {"siteEntry": [{"siteUrl": "https://agsist.com/"},
                                                                    {"siteUrl": "sc-domain:agsist.com"},
                                                                    {"siteUrl": "https://other.com/"}]}})()

        def post(self, url, json, timeout=None):
            self.bodies.append((url, json))
            if json["dimensions"] == ["date"]:
                rows = [{"keys": ["2026-09-20"], "clicks": 30, "impressions": 900, "ctr": .03, "position": 9}]
            else:
                rows = [{"keys": ["cash bids near me"], "clicks": 12, "impressions": 300, "ctr": .04, "position": 5.44}]
            return type("J", (), {"raise_for_status": lambda s: None, "json": lambda s: {"rows": rows}})()
    s = Sess()
    gs = gsc_section(s, rg, today)
    t(gs["site"] == "sc-domain:agsist.com", "the domain property is preferred over a URL-prefix one")
    t(all(b[1]["dimensionFilterGroups"][0]["filters"][0]["expression"] == "usa" for b in s.bodies), "Search Console is US searches only")
    t("sc-domain%3Aagsist.com" in s.bodies[0][0], "the property is URL-encoded into the path")
    t(gs["queries"]["rows"][0] == {"q": "cash bids near me", "clicks": 12, "impr": 300, "pos": 5.4}, "queries carry clicks, impressions, position")

    # Bing
    def get(method, params):
        if method == "GetUserSites":
            return {"d": [{"Url": "https://agsist.com/"}]}
        if method == "GetRankAndTrafficStats":
            return {"d": [{"Date": "/Date(1790060400000-0700)/", "Clicks": 90, "Impressions": 3000}]}
        wk = lambda d: "/Date(%d)/" % (datetime(2026, 9, d, tzinfo=timezone.utc).timestamp() * 1000)
        return {"d": [{"Date": wk(1), "Query": "grain bids", "Clicks": 5, "Impressions": 50},
                      {"Date": wk(8), "Query": "grain bids", "Clicks": 6, "Impressions": 60},
                      {"Date": wk(15), "Query": "hail map", "Clicks": 9, "Impressions": 70},
                      {"Date": wk(22), "Query": "cbot corn", "Clicks": 1, "Impressions": 40},
                      {"Date": "/Date(1700000000000)/", "Query": "old", "Clicks": 99, "Impressions": 999}]}
    b = bing_section(get, rg, today)
    t(b["days"] == {"2026-09-22": {"clicks": 90, "impr": 3000}}, "Bing's /Date(ms)/ is read as a UTC date")
    t([r["q"] for r in b["queries"]["rows"]] == ["grain bids", "hail map", "cbot corn"], "only the last four weekly buckets, summed per query")
    t(b["queries"]["start"] == "2026-09-01" and b["queries"]["end"] == "2026-09-22", "the query window is the buckets' own dates")

    t(email_count("https://w", "t", fetch=lambda u: "a@x.com,\nB@x.com\nb@x.com\n\nnot-an-email") == 2,
      "the subscriber count de-duplicates and keeps only the count")

    out = build(today, {}, g, gs, b, 42)
    t(out["schema"] == SCHEMA and out["email"]["subscribers"] == 42, "a full build carries every section")
    day = [x for x in out["series"]["days"] if x["d"] == "2026-09-22"][0]
    t(day["users"] == 11 and day["bClicks"] == 90 and day["gClicks"] is None, "one day row joins all three sources; a missing one is null, not zero")
    prev = out
    out2 = build(today, prev, None, gs, None, None, {"ga4": "boom"})
    t(out2["totals"] == prev["totals"] and out2["sources"]["ga4"]["ok"] is False and out2["sources"]["ga4"]["error"] == "boom",
      "a failed GA4 run keeps the previous numbers and says it failed")
    day2 = [x for x in out2["series"]["days"] if x["d"] == "2026-09-22"][0]
    t(day2["users"] == 11 and day2["bClicks"] == 90, "the carried days survive a partial run")
    t(out2["email"]["subscribers"] == 42, "a missing subscriber count carries the last one with its date")
    exp = {"schema": SCHEMA, "mode": "export", "ranges": [{"id": "ytd", "label": "2026", "start": "2026-01-01", "end": "2026-09-22"}],
           "totals": {"ytd": {"users": 5}}, "states": {"ytd": []}, "stateFlagRule": {"seconds": 40},
           "searchStatic": {"google": {}}, "ai": {"perDay": 1}}
    o3 = build(today, exp, None, gs, None, None)
    t(o3["mode"] == "export" and o3["stateFlagRule"] == {"seconds": 40} and o3["ranges"] == exp["ranges"],
      "with GA4 still unconnected, the export's figures keep the export's windows and flag rule")
    t("searchStatic" not in o3 and o3["ai"] == {"perDay": 1}, "live search replaces the export's search card; AI citations carry")
    o5 = build(today, dict(exp, searchStatic={"google": {"c": 1}, "bing": {"c": 2}}), None, None, b, None)
    t(o5["searchStatic"] == {"google": {"c": 1}}, "Bing live alone removes only the Bing export card")
    t(o5["series"]["end"] == "2026-09-22", "the series ends at the last finished day even when GA4 carried older windows")
    t(is_ours("sc-domain:agsist.com") and is_ours("https://www.agsist.com/") and not is_ours("https://notagsist.com/")
      and not is_ours("https://agsist.com.evil.io/"), "only agsist.com itself is taken as ours")

    class Bad:
        def get(self, url, timeout=None):
            return type("R", (), {"raise_for_status": lambda s: (_ for _ in ()).throw(RuntimeError("403")), "json": lambda s: {}})()
    try:
        gsc_section(Bad(), rg, today)
        t(False, "a Search Console HTTP error fails the source")
    except RuntimeError:
        t(True, "a Search Console HTTP error fails the source instead of reading as an empty month")
    o4 = build(today, exp, g, None, None, None)
    t("mode" not in o4 and "stateFlagRule" not in o4 and set(o4["totals"]) == {"7d", "28d", "90d", "ytd"},
      "once GA4 answers, the export's single range and flag rule are gone")
    # ── returns: hand-worked ──────────────────────────────────────────────
    # The window ends Sat Oct 17. A week's last day must be 14 days behind
    # that, so on or before Sat Oct 3: the newest whole Monday-Sunday week is
    # Sep 21-27 (Sep 27 + 14 = Oct 11), and Sep 28-Oct 4 is NOT (Oct 4 + 14 =
    # Oct 18, after the end). Eight weeks back from it starts Aug 3.
    rg2 = ranges(date(2026, 10, 19))
    wks = cohort_weeks(date(2026, 10, 17))
    t(len(wks) == 8 and wks[-1] == (date(2026, 9, 21), date(2026, 9, 27)) and wks[0] == (date(2026, 8, 3), date(2026, 8, 9)),
      "cohort weeks: the newest is the last whole week 14 days behind the end, eight in all, Monday first")
    t(cohort_weeks(date(2026, 10, 11))[-1] == (date(2026, 9, 21), date(2026, 9, 27)),
      "a week whose Sunday is exactly 14 days back is complete")
    # The withhold gate, at its edge: 100 prints, 99 does not.
    wk = [(date(2026, 9, 14), date(2026, 9, 20)), (date(2026, 9, 21), date(2026, 9, 27))]
    cr = cohort_rows(wk, {"20260914": 99, "20260921": 60, "20260927": 40}, {"20260914": 30, "20260921": 9, "20260927": 3})
    t(cr[0]["share"] is None and cr[0]["newReaders"] == 99 and "99 new readers" in cr[0]["withheld"] and cr[0]["returned"] == 30,
      "a week under 100 new readers prints its reason and its n, not a share")
    t(cr[1] == {"week": "2026-09-21", "end": "2026-09-27", "newReaders": 100, "returned": 12, "share": 0.12, "withheld": None},
      "100 new readers, 12 back: 12% (9 + 3 of 60 + 40), with n beside it")

    SIZES = {"20260921": 70, "20260922": 50, "20260926": 30, "20260915": 40}      # Sep 21-27: 150; Sep 14-20: 40
    BACK = {"20260921": 14, "20260922": 9, "20260926": 4, "20260915": 6}         # Sep 21-27: 27 of 150 = 18%
    seen2 = []

    def in_list(f):
        out = []
        for e in f.and_group.expressions:
            if e.filter.field_name in ("firstSessionDate", "eventName"):
                out += list(e.filter.in_list_filter.values)
        return out

    class Client2:
        def run_report(self, req):
            seen2.append(req)
            dims = [d.name for d in req.dimensions]
            mets = [m.name for m in req.metrics]
            multi = len(req.date_ranges) > 1
            rows = []
            if dims == ["newVsReturning"]:
                for r in req.date_ranges:
                    for nv, u, s_, e in (("new", 900, 1000, 600), ("returning", 200, 500, 400), ("(not set)", 1, 2, 0)):
                        rows.append([nv, r.name, u, s_, e])
                return Res(dims + ["dateRange"], mets, rows)
            if dims == ["firstSessionDate"]:
                want = in_list(req.dimension_filter)
                if not multi and req.date_ranges[0].name == "c":
                    return Res(dims, mets, [[d, SIZES[d]] for d in want if d in SIZES])
                for r in req.date_ranges:
                    for d in want:
                        if r.name == "d" + d:
                            if BACK.get(d):
                                rows.append([d, r.name, BACK[d]])
                        else:
                            rows.append([d, r.name, 999])       # the wrong (day, range) pair: must be ignored
                return Res(dims + (["dateRange"] if multi else []), mets,
                           [x if multi else [x[0], x[2]] for x in rows])
            if dims == ["date", "eventName"]:
                return Res(dims, mets, [["20260921", "rain_print_draw", 5], ["20260927", "rain_print_draw", 3],
                                        ["20260928", "purchase", 1], ["20260920", "email_signup", 2],
                                        ["20261013", "rain_print_draw", 7]])
            if dims == ["eventName"]:
                return Res(dims, mets, [["rain_print_draw", 40, 12], ["email_signup", 2, 2], ["purchase", 1, 1]])
            raise AssertionError("unexpected request %s" % dims)

    F2 = f_readers([{"region": "Virginia", "city": "Ashburn"}])
    ret = returns_section(GA4("123", Client2()), F2, rg2)
    nv = ret["newVsReturning"]
    t(set(nv) == {"28d", "90d"} and nv["28d"]["rows"]["returning"] == {"users": 200, "sessions": 500, "engaged": 400}
      and nv["28d"]["rows"]["not set"]["sessions"] == 2 and nv["28d"]["sessions"] == 1502,
      "new vs returning: users and sessions per window, the unset row kept apart")
    t(nv["90d"]["returningSessionShare"] == 0.333 and "returningUserShare" not in nv["90d"],
      "the share is of sessions (500 of 1,502), never of users, whose rows overlap")
    cw = {x["week"]: x for x in ret["cohorts"]["weeks"]}
    t(cw["2026-09-21"]["newReaders"] == 150 and cw["2026-09-21"]["returned"] == 27 and cw["2026-09-21"]["share"] == 0.18,
      "a cohort: 27 of 150 came back within 14 days = 18%, the wrong date-range pairs ignored")
    t(cw["2026-09-14"]["share"] is None and cw["2026-09-14"]["newReaders"] == 40 and cw["2026-09-14"]["returned"] == 6,
      "a 40-reader cohort is withheld with its n")
    t(cw["2026-08-03"]["newReaders"] == 0 and cw["2026-08-03"]["share"] is None, "a week with no rows is zero readers, withheld, not 0%")
    backs = [r for r in seen2 if [d.name for d in r.dimensions] == ["firstSessionDate"] and r.date_ranges[0].name != "c"]
    t(len(backs) == 14 and all(len(r.date_ranges) <= 4 for r in backs), "56 cohort days asked four at a time, the API's limit")
    pairs = [(r.name, r.start_date, r.end_date) for q in backs for r in q.date_ranges]
    t(("d20260921", "2026-09-22", "2026-10-05") in pairs and len({p[0] for p in pairs}) == 56,
      "each first day d is asked for d+1 to d+14: a later day, within 14 days")
    t(max(p[2] for p in pairs) <= rg2[0]["end"], "no cohort window reaches past the last finished day")
    sz = [r for r in seen2 if [d.name for d in r.dimensions] == ["firstSessionDate"] and r.date_ranges[0].name == "c"][0]
    t((sz.date_ranges[0].start_date, sz.date_ranges[0].end_date) == ("2026-08-03", "2026-09-27") and len(in_list(sz.dimension_filter)) == 56,
      "cohort sizes: first seen Aug 3 to Sep 27, one request")
    t(all("United States" in str(r.dimension_filter) and "Ashburn" in str(r.dimension_filter) for r in seen2),
      "every returns and funnel request is US only with the server towns out")
    t(len(ret["caveats"]) >= 4 and any("two readers" in c for c in ret["caveats"]) and any("7 days" in c for c in ret["caveats"]),
      "the file names GA4's caveats: cookies, two devices, cookie expiry, consent and blocking")

    seen2.clear()
    fn = funnel_section(GA4("123", Client2()), F2, rg2)
    fw = {x["week"]: x["counts"] for x in fn["weeks"]}
    t(len(fn["weeks"]) == 8 and fn["weeks"][-1]["week"] == "2026-10-05" and fn["weeks"][-1]["end"] == "2026-10-11",
      "funnel weeks: the last whole Monday-Sunday week before the end, eight of them")
    t(fw["2026-09-21"]["rain_print_draw"] == 8 and fw["2026-09-28"]["purchase"] == 1 and fw["2026-09-14"]["email_signup"] == 2
      and fw["2026-09-21"]["purchase"] == 0, "events land in their own Monday week (Sun Sep 27 is Sep 21's, Mon Sep 28 the next)")
    t("2026-10-12" not in fw, "the unfinished week is left out of the weekly rows")
    t(fn["last7"]["counts"]["rain_print_draw"] == 40 and fn["last7"]["people"]["rain_print_draw"] == 12
      and fn["last7"]["counts"]["rain_print_buy"] == 0, "last 7 days: counts and people per event; no row is zero")
    t(all("BEGINS_WITH" in str(r.dimension_filter) and "/rain-print" in str(r.dimension_filter) for r in seen2)
      and set(in_list(seen2[0].dimension_filter)) == {e for e, _, _ in FUNNEL},
      "funnel requests: only the Rain Print events, only on /rain-print pages")
    t(not any(d.name.startswith("customEvent") or d.name in ("transactionId", "pageLocation") for r in seen2 for d in r.dimensions),
      "no event parameter, transaction id or full URL is ever asked for")
    t(fn["stripe"] is None, "no Stripe figure is invented here")

    o6 = build(date(2026, 10, 19), {"rain_print_funnel": fn, "sources": {"rain_print_funnel": {"ok": True}}}, g, None, None, None, returns=ret)
    t(o6["returns"] is ret and o6["sources"]["returns"]["ok"], "returns go into the file")
    t("rain_print_funnel" not in o6 and "rain_print_funnel" not in o6["sources"]
      and "rain_print" not in json.dumps(o6) and "purchase" not in json.dumps(o6),
      "no Rain Print funnel number reaches the public file, even one an older file carried")
    o7 = build(date(2026, 10, 20), o6, g, None, None, None, {"returns": "boom"})
    t(o7["returns"] == ret and o7["sources"]["returns"]["ok"] is False and o7["sources"]["returns"]["error"] == "boom"
      and o7["returns"]["through"] == "2026-10-17",
      "a failed returns pull keeps the last one, with its own through date, and says it failed")
    # Promo clicks by page, gauge signups, email sessions by source (private).
    class Client3:
        def run_report(self, req):
            seen3.append(req)
            dims = [d.name for d in req.dimensions]
            mets = [m.name for m in req.metrics]
            if dims == ["eventName", "pagePath"]:
                return Res(dims + ["dateRange"], mets, [
                    ["rain_print_promo_click", "/", "7d", 5], ["rain_print_promo_click", "/cash-bids", "7d", 3],
                    ["rain_print_promo_click", "/", "28d", 20], ["rain_gauge_promo_click", "/rain/iowa", "28d", 2],
                    ["notice_signup", "/rain-gauge", "7d", 2], ["notice_signup", "/rain-gauge.html", "28d", 4],
                    ["notice_signup", "/rent/iowa/", "28d", 9], ["rain_print_promo_click", "/x", "90d", 99]])
            if dims == ["sessionSource", "sessionManualAdContent"]:
                return Res(dims + ["dateRange"], mets, [
                    ["daily", "button", "7d", 4, 3], ["daily", "rainprint", "7d", 2, 2], ["daily_email", "(not set)", "7d", 1, 0],
                    ["report_email", "(not set)", "7d", 3, 1], ["daily", "button", "28d", 9, 6]])
            raise AssertionError("unexpected request %s" % dims)
    seen3 = []
    pc = promo_section(GA4("123", Client3()), F2, rg2)
    w7, w28 = pc["windows"]["7d"], pc["windows"]["28d"]
    t(w7["promos"]["rain_print_promo_click"] == {"total": 8, "pages": [{"page": "/", "count": 5}, {"page": "/cash-bids", "count": 3}]}
      and w7["promos"]["rain_gauge_promo_click"] == {"total": 0, "pages": []}
      and w28["promos"]["rain_gauge_promo_click"]["total"] == 2 and w28["promos"]["rain_print_promo_click"]["total"] == 20,
      "promo clicks by page and window; a window with none is zero; a stray range is ignored")
    t(w7["gaugeSignups"] == 2 and w28["gaugeSignups"] == 4, "gauge signups: notice_signup on /rain-gauge pages only")
    t([x["source"] for x in w7["email"]["bySource"]] == ["daily", "report_email", "daily_email"]
      and w7["email"]["bySource"][0] == {"source": "daily", "sessions": 6, "engaged": 5}
      and w7["email"]["daily"] == [{"content": "button", "sessions": 4}, {"content": "rainprint", "sessions": 2}, {"content": "(not set)", "sessions": 1}],
      "email sessions by utm_source, and the Daily's by utm_content (old daily_email counted with it)")
    t(len(seen3) == 2 and all("United States" in str(r.dimension_filter) and "Ashburn" in str(r.dimension_filter) for r in seen3)
      and "email" in str(seen3[1].dimension_filter) and {r.name for q in seen3 for r in q.date_ranges} == {"7d", "28d"},
      "promo requests: US, server towns out, 7 and 28 days, email medium only for sessions")
    t(not any(d.name.startswith("customEvent") or d.name in ("transactionId", "pageLocation") for r in seen3 for d in r.dimensions),
      "promo requests: no event parameter, transaction id or full URL")
    o8 = build(date(2026, 10, 19), {"promos": pc, "sources": {"promos": {"ok": True}}}, g, None, None, None, returns=ret)
    t("promo" not in json.dumps(o8) and "gaugeSignups" not in json.dumps(o8) and "report_email" not in json.dumps(o8),
      "no promo or email-session number reaches the public file")
    print("selftest " + ("passed" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
