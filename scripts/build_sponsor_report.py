#!/usr/bin/env python3
"""Bake a sponsor's numbers out of GA4, once a day, into a file in git.

    python3 scripts/build_sponsor_report.py

WHY A DAY BEHIND AND NOT LIVE

A live counter needs a server. This site is static, so a real-time number would
mean standing up a Worker and a store to hold counts — a second source of truth
for a number a sponsor is going to compare against GA4 anyway. Reading GA4
itself and committing the answer means there is ONE number, it is the one in
the analytics account, and it is in git where it can be looked at later.

WHAT IT REPORTS, AND WHAT EACH THING MEANS

    viewable impressions  50% of the ad's pixels in the viewport for one
                          continuous second — the MRC/IAB rule
    clicks                a click on the sponsor's link
    CTR                   clicks / viewable impressions
    by day                a 90-day series
    by page               where it was seen

STANDARD DIMENSIONS ONLY. Event parameters like `slot` can be queried as
`customEvent:slot`, but ONLY after being registered as a custom dimension in
the GA4 admin — and an unregistered one returns nothing rather than an error,
which is the quietest possible way to ship an empty report. So this uses
`eventName`, `date` and `pagePath`, which always exist. If `slot` is registered
later, SLOT_DIMENSION below turns it on.

WHAT IS DELIBERATELY NOT COUNTED, AND WHY THAT MATTERS MORE THAN WHAT IS

Three event names looked like sponsor metrics and are not:

    sponsor_impression   fired on the homepage block, which has shown the HOUSE
                         pitch ("Available - Founding Sponsor") every day of its
                         life. No paying sponsor has ever been in it.
    hm_sponsor_view      same, on the hail map's "Sponsor this map" ribbon.
    sponsor_cta_click    a click on "become a sponsor" - in the footer legal
                         row, the contact card, and the empty ad slot. That is
                         somebody wanting to BUY an ad, not somebody clicking
                         one.

Adding any of them to a sponsor's totals would report views of us advertising
our own empty slot as views of that sponsor's ad. So none of them is counted.
The site fired them honestly for its own purposes; they are just not this.

SECRETS: GA4_PROPERTY_ID (the numeric id, not the G- measurement id) and
GA4_SERVICE_ACCOUNT (the service account JSON, whole). The service account
needs Viewer on the property. Without them this exits 0 and writes nothing, so
a fork or a PR does not fail on a secret it cannot have.
"""
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "data" / "sponsors.json"
OUTDIR = ROOT / "data" / "sponsors"

# The day the viewable rule became the MRC one.
DEFINITION_CHANGED = "2026-09-05"

# Registered custom dimension for the slot, if it ever is. `None` = do not ask.
SLOT_DIMENSION = None       # e.g. "customEvent:slot"

VIEWABLE_EVENTS = ["sponsor_viewable"]

# EMPTY, ON PURPOSE -- see the note above. Every impression event this site has
# ever fired came from a slot advertising the slot. There is no sponsor history
# to carry forward, so there is nothing honest to put here.
LEGACY_VIEW_EVENTS = []

# `supporter_click` is a real click on a filled footer card and stays. The
# markup that fired it now carries data-sponsor-click instead, and the old call
# was DELETED in the same commit -- if both had been left in place one click
# would have been counted twice.
CLICK_EVENTS = ["sponsor_click", "supporter_click"]


def fail(msg):
    print("::error::" + msg)
    sys.exit(1)


def main():
    if not CONF.exists():
        print("no data/sponsors.json — nothing to build")
        return 0
    conf = json.loads(CONF.read_text(encoding="utf-8"))
    sponsors = [s for s in conf.get("sponsors", []) if s.get("active", True)]
    if not sponsors:
        print("no active sponsors")
        return 0

    # ══════════════════════════════════════════════════════════════════════
    #  ONE SPONSOR AT A TIME, UNTIL THE SLOT DIMENSION IS REGISTERED
    # ══════════════════════════════════════════════════════════════════════
    #  Without `customEvent:slot` there is no way to tell one sponsor's
    #  `sponsor_viewable` events from another's -- every report would show the
    #  site-wide total. With one sponsor that total IS their number. With two it
    #  is both of their numbers, handed to each of them as their own, and
    #  neither would have any way to notice.
    #
    #  So this refuses rather than guesses. Register `slot` as a custom
    #  dimension in the GA4 admin, set SLOT_DIMENSION above, and the refusal
    #  lifts.
    if len(sponsors) > 1 and not SLOT_DIMENSION:
        fail("%d active sponsors but SLOT_DIMENSION is not set, so every report "
             "would carry the site-wide total and call it that sponsor's. "
             "Register `slot` as a custom dimension in GA4, set SLOT_DIMENSION "
             "in this file, or leave one sponsor active." % len(sponsors))

    prop = os.environ.get("GA4_PROPERTY_ID", "").strip()
    cred = os.environ.get("GA4_SERVICE_ACCOUNT", "").strip()
    if not prop or not cred:
        # Not a failure. A PR from a fork has no secrets and should not go red.
        print("::warning::GA4_PROPERTY_ID or GA4_SERVICE_ACCOUNT is not set — "
              "no report was written. Set both on the repository for this to run.")
        return 0

    try:
        from google.analytics.data_v1beta import BetaAnalyticsDataClient
        from google.analytics.data_v1beta.types import (
            DateRange, Dimension, Filter, FilterExpression, FilterExpressionList,
            Metric, RunReportRequest)
        from google.oauth2 import service_account
    except ImportError:
        fail("google-analytics-data is not installed — the workflow's pip step "
             "must install it before this runs")

    try:
        info = json.loads(cred)
    except json.JSONDecodeError:
        fail("GA4_SERVICE_ACCOUNT is not valid JSON — paste the whole key file, "
             "including the braces")
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    client = BetaAnalyticsDataClient(credentials=creds)

    def in_list(field, values):
        return FilterExpression(filter=Filter(
            field_name=field,
            in_list_filter=Filter.InListFilter(values=list(values))))

    def run(dimensions, events, start, end):
        # AN EMPTY LIST ASKS FOR NOTHING, AND MUST NOT ASK AT ALL.
        # `inListFilter` with no values is not "match none" to GA4 -- it is a
        # malformed filter, and the quietest outcome is a report that silently
        # matches every event on the property. LEGACY_VIEW_EVENTS is empty by
        # design, so this path is taken on every run.
        if not events:
            return []
        req = RunReportRequest(
            property="properties/" + prop,
            dimensions=[Dimension(name=d) for d in dimensions],
            metrics=[Metric(name="eventCount")],
            date_ranges=[DateRange(start_date=start, end_date=end)],
            dimension_filter=in_list("eventName", events),
            limit=100000,
        )
        rows = []
        for r in client.run_report(req).rows:
            rows.append([d.value for d in r.dimension_values] +
                        [int(r.metric_values[0].value)])
        return rows

    OUTDIR.mkdir(parents=True, exist_ok=True)
    today = date.today()
    # GA4 keeps refining "today" for hours, so the report ends YESTERDAY and
    # says so. A number that changes after the sponsor looked at it is worse
    # than one that is a day old.
    end = today - timedelta(days=1)
    written = []

    for s in sponsors:
        slug, token = s["slug"], s["token"]
        pages = s.get("pages")          # None = every page
        start = s.get("start")

        # ══════════════════════════════════════════════════════════════════
        #  NO START DATE MEANS NO NUMBERS, NOT A DEFAULT WINDOW
        # ══════════════════════════════════════════════════════════════════
        #  This used to fall back to "the last 90 days", which for a sponsor
        #  who has not run yet means handing them ninety days of somebody
        #  else's traffic as their own performance. Rule 1: do not invent a
        #  number. A report is still written -- and it is a real page the
        #  sponsor can be sent today -- it just says the counter starts when
        #  their first ad runs.
        if not start:
            f = OUTDIR / ("%s-%s.json" % (slug, token))
            f.write_text(json.dumps({
                "schema": "agsist-sponsor-report/1",
                "sponsor": s.get("name", slug),
                "slug": slug,
                "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "through": end.isoformat(),
                "start": None,
                "pending": True,
                "pages": pages,
                "totals": {"viewable": 0, "clicks": 0, "ctr": None, "legacyImpressions": 0},
                "windows": [], "series": [], "byPage": [],
            }, indent=1) + "\n", encoding="utf-8")
            written.append("%s: not started -- no start date set, wrote the pending page" % slug)
            continue

        def tally(events, dims):
            rows = run(dims, events, start, end.isoformat())
            if pages and "pagePath" in dims:
                i = dims.index("pagePath")
                rows = [r for r in rows if r[i] in pages]
            return rows

        by_day = tally(VIEWABLE_EVENTS, ["date", "pagePath"])
        by_day_legacy = tally(LEGACY_VIEW_EVENTS, ["date", "pagePath"])
        clicks = tally(CLICK_EVENTS, ["date", "pagePath"])

        def fold(rows, key_idx):
            out = {}
            for r in rows:
                out[r[key_idx]] = out.get(r[key_idx], 0) + r[-1]
            return out

        views_day = fold(by_day, 0)
        legacy_day = fold(by_day_legacy, 0)
        clicks_day = fold(clicks, 0)
        views_page = fold(by_day, 1)
        clicks_page = fold(clicks, 1)

        days = sorted(set(list(views_day) + list(legacy_day) + list(clicks_day)))
        series = [{
            "d": d[:4] + "-" + d[4:6] + "-" + d[6:],
            "v": views_day.get(d, 0),
            "l": legacy_day.get(d, 0),
            "c": clicks_day.get(d, 0),
        } for d in days]

        tv, tl, tc = sum(views_day.values()), sum(legacy_day.values()), sum(clicks_day.values())

        def window(n):
            cut = (end - timedelta(days=n - 1)).isoformat()
            w = [x for x in series if x["d"] >= cut]
            v, c = sum(x["v"] for x in w), sum(x["c"] for x in w)
            return {"days": n, "viewable": v, "clicks": c,
                    "ctr": round(100.0 * c / v, 2) if v else None}

        payload = {
            "schema": "agsist-sponsor-report/1",
            "sponsor": s.get("name", slug),
            "slug": slug,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "through": end.isoformat(),
            "start": start,
            "pages": pages,
            "definitionChanged": DEFINITION_CHANGED,
            "totals": {
                "viewable": tv, "clicks": tc,
                "ctr": round(100.0 * tc / tv, 2) if tv else None,
                "legacyImpressions": tl,
            },
            "windows": [window(7), window(30), window(90)],
            "series": series,
            "byPage": sorted(
                [{"page": p, "viewable": v, "clicks": clicks_page.get(p, 0)}
                 for p, v in views_page.items()],
                key=lambda x: -x["viewable"]),
        }
        f = OUTDIR / ("%s-%s.json" % (slug, token))
        f.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
        written.append("%s: %d viewable, %d clicks through %s" % (slug, tv, tc, end))

    for line in written:
        print("  " + line)
    print("wrote %d report(s) to %s" % (len(written), OUTDIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
