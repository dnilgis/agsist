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

# Where an approval lands. Per-sponsor override in sponsors.json: approve_to.
APPROVE_TO = "sig@farmers1st.com"

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


# ── THE PROOF ─────────────────────────────────────────────────────────────
# A sponsor approving an ad has to be approving SPECIFIC WORDS, or the approval
# means nothing. There is no server here to record a click, so the approval is
# an email -- and what makes it worth having is the code.
#
# proof_code is a short hash of the exact fields that reach a reader: the
# advertiser, the headline, the body, the CTA text, the destination and the
# disclosure. Change any of them and the code changes. The portal shows it, the
# approval email carries it, and when the two stop matching the portal says so
# rather than showing an approved badge over copy nobody approved.
#
# Deliberately NOT a signature. It proves WHICH WORDS, not who said yes -- that
# is what the reply-to address is for. A four-byte hash is enough to catch a
# changed word and short enough to read down a phone.

# 2026-09-20: facts, phone and logo joined the six. Each one reaches a reader
# (the facts row, the "or call" link, the logo tile), so each one is something a
# sponsor is approving. Adding them changes every existing code, which is
# correct: no approval had been given against the old six, and an approval that
# did not cover the phone number printed under it would not be an approval.
CREATIVE_FIELDS = ("advertiser", "headline", "body", "facts", "cta_text", "cta_url",
                   "phone", "logo", "disclosure")


def _field_text(v):
    """A list (the facts) is joined with a separator no text field contains, so
    ["a b", "c"] and ["a", "b c"] cannot hash alike."""
    if isinstance(v, (list, tuple)):
        return "\x1e".join(str(x) for x in v)
    return str(v or "")


def proof_code(creative):
    """Eight hex characters over the fields a reader actually sees."""
    import hashlib
    if not creative:
        return None
    blob = "\x1f".join(_field_text(creative.get(k)) for k in CREATIVE_FIELDS)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:8]


def creative_block(slug):
    """What this sponsor's ad says, where it points, and the code for it.

    Returns None when there is no creative on file -- a sponsor who has not
    been given one yet gets the pending page, not an empty proof.
    """
    src = ROOT / "data" / "sponsor.json"
    if not src.exists():
        return None
    try:
        c = json.loads(src.read_text())
    except (OSError, ValueError):
        return None
    # WHOSE CREATIVE IS THIS? An unattributed one is refused outright rather
    # than handed to whichever sponsor asked. With two sponsors configured and
    # no slug on the file, the second one's portal would have shown the first
    # one's ad for approval -- and the proof code would have matched, which is
    # the worst possible version of that mistake.
    if not c.get("slug"):
        print("  [warn] data/sponsor.json has no slug; refusing to attribute it")
        return None
    if c["slug"] != slug:
        return None
    if c.get("is_house_ad"):
        return None
    url = c.get("cta_url") or ""
    links = {}
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import sponsor_links
        links = sponsor_links.all_surfaces(url, slug) if url else {}
    except Exception:
        links = {}
    # The browser-drawn surfaces (homepage, /daily, and this portal's own
    # previews) read tagged links from cta_urls, the same way data/daily.json
    # carries them. Built from the same links dict, so the portal and the live
    # pages cannot tag differently.
    shown = dict(c)
    shown["cta_urls"] = {k: links[k] for k in ("homepage", "daily_page", "archive") if k in links}
    return {
        "live": bool(c.get("active")),
        "proof_code": proof_code(c),
        "fields": {k: c.get(k) for k in CREATIVE_FIELDS},
        "label": c.get("label") or "SPONSORED",
        "tier": c.get("tier"),
        "links": links,
        "cta_urls": shown["cta_urls"],
        "previews": previews(shown),
    }


# ---------------------------------------------------------------------------
# THE PREVIEWS, RENDERED BY THE CODE THAT PUBLISHES -- NOT BY A LOOKALIKE.
#
# The portal used to draw its own approximation of the ad: .sr-ad, .sr-ad-head,
# .sr-ad-cta, hand-styled in sponsor-report.html to resemble the site. Same six
# fields in the same order, and `dv3-sponsor` appeared ZERO times in that file.
#
# That is a second copy of the definition, and it fails in the worst possible
# direction. Change the real block's CSS and the proof drifts from what runs
# WHILE THE PROOF CODE STILL MATCHES -- the code is a hash over the six text
# fields, so it cannot see a styling change. The sponsor approves a picture of
# something that is not what ships, and both sides have a matching code saying
# they agreed.
#
# So nothing here is drawn. Every preview below is the output of the function
# that actually writes that surface:
#
#     homepage, archive   generate_daily.render_sponsor_block_html(sp, surface)
#     html email          brief_email.sponsor_block({"sponsor": sp})
#     plain text          brief_email's text part, same fields, same order
#
# If any of those change, the preview changes with them on the next build,
# because it IS them.
# ---------------------------------------------------------------------------

def previews(c):
    """What this ad looks like on each surface it runs on.

    Returns {} rather than a half-built set when the renderers cannot be
    imported: a missing preview is a portal with one section absent, and a
    WRONG preview is a sponsor approving the wrong thing. The first is
    recoverable.
    """
    out = {}
    # THE PAGES ARE DRAWN IN THE PORTAL BY components/sponsor-ad.js -- the file
    # the homepage and /daily load -- from the fields above. The archive block
    # is baked here by generate_daily.render_sponsor_block_html, which
    # scripts/sponsor-checks.mjs holds byte-identical to the JS. No preview is a
    # lookalike; each one is the renderer that publishes that surface.
    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import generate_daily as gd
        out["archive"] = gd.render_sponsor_block_html(c, surface="archive")
    except Exception as e:                                    # noqa: BLE001
        print("  [warn] no page preview (%s: %s)" % (type(e).__name__, e))

    try:
        sys.path.insert(0, str(ROOT / "scripts"))
        import brief_email as be
        # active=True ON THE COPY ONLY. sponsor_block() returns "" for an
        # inactive sponsor, which is right for sending and wrong for a proof:
        # the whole point of this page is showing an ad BEFORE it runs. The
        # file on disk is not touched and data/sponsor.json keeps its own
        # active flag -- nothing here can put an ad in front of a reader.
        out["email_html"] = be.sponsor_block({"sponsor": dict(c, active=True)})
    except Exception as e:                                    # noqa: BLE001
        print("  [warn] no email preview (%s: %s)" % (type(e).__name__, e))

    return out


def portal_extras(s):
    """What the portal needs beyond the numbers: the approval on record, the
    contract terms, and who to call. All of it is read from data/sponsors.json,
    typed there by Sig, never inferred.

    approved  {"proof": "xxxxxxxx", "on": "YYYY-MM-DD", "by": "name"} -- set when
              the approval email arrives. The portal shows APPROVED only when
              this proof equals the current proof code; if the copy changed
              since, it says the approval does not cover the new words.
    billing   {"tier": "founding", "trial_weeks": 2, "rate_lock_months": 12,
               "invoice_to": "...", "notes": "..."} -- the deal as agreed. The
              schedule on the portal is computed from this and the start date.
    """
    return {
        "approval": s.get("approved") or None,
        "billing": s.get("billing") or None,
        "contact": s.get("contact") or None,
        "placements": s.get("placements") or None,
    }


def rate_card():
    f = ROOT / "data" / "rate-card.json"
    try:
        return json.loads(f.read_text())
    except (OSError, ValueError):
        return None


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
        #
        # BUT THE PROOF DOES NOT DEPEND ON ANALYTICS. Approving the copy is the
        # thing that happens first and it must not wait on a GA4 credential.
        # This refreshes the creative, the tagged links and the rate card on
        # every existing report, leaves the numbers exactly as they were, and
        # says so. Without it, a broken GA4 secret would also mean a sponsor
        # could not see what they are being asked to approve.
        n = 0
        OUTDIR.mkdir(parents=True, exist_ok=True)
        for s_ in sponsors:
            slug_, token_ = s_.get("slug"), s_.get("token")
            if not slug_ or not token_:
                continue
            f_ = OUTDIR / ("%s-%s.json" % (slug_, token_))
            try:
                cur = json.loads(f_.read_text()) if f_.exists() else {
                    "schema": "agsist-sponsor-report/1",
                    "sponsor": s_.get("name", slug_), "slug": slug_,
                    "through": None, "start": s_.get("start"), "pending": True,
                    "pages": s_.get("pages"),
                    "totals": {"viewable": 0, "clicks": 0, "ctr": None,
                               "legacyImpressions": 0},
                    "windows": [], "series": [], "byPage": [],
                }
            except (OSError, ValueError) as e:
                print("  [skip] %s: %s" % (slug_, e))
                continue
            cur["creative"] = creative_block(slug_)
            cur["rateCard"] = rate_card()
            cur["approveTo"] = s_.get("approve_to") or APPROVE_TO
            cur.update(portal_extras(s_))
            cur["creativeRefreshed"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            f_.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")
            n += 1
        print("::warning::GA4_PROPERTY_ID or GA4_SERVICE_ACCOUNT is not set — "
              "the numbers were not refreshed. Set both on the repository for "
              "that to run. Wrote the creative and rate card on %d report(s); "
              "the counts in them are as of their last successful run." % n)
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
                # The proof and the rate card do NOT wait for a start date.
                # Approving the copy is the thing that happens first, and a
                # sponsor with no numbers yet is exactly who needs to see it.
                "creative": creative_block(slug),
                "rateCard": rate_card(),
                "approveTo": s.get("approve_to") or APPROVE_TO,
                **portal_extras(s),
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
            "creative": creative_block(slug),
            "rateCard": rate_card(),
            "approveTo": s.get("approve_to") or APPROVE_TO,
            **portal_extras(s),
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
