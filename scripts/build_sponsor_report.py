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
                         pitch (the empty sponsor slot for sale) every day of its
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
import re
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
APPROVE_TO = "sig@agsist.com"

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


# ── A STATE-TARGETED SPONSOR (Oct 28, 2026; RootLot, a free test) ─────────
# Its ad lives in data/geo-sponsors.json (components/geo-sponsor.js draws it),
# not in data/sponsor.json. The portal is the same page; sponsors.json says
# "geo": "<id in geo-sponsors.json>". The proof code covers the same fields a
# reader sees, read from that entry. Every link carries
# utm_source=agsist&utm_medium=sponsor&utm_campaign=<utm_campaign>&utm_content=<surface>,
# made the same way components/geo-sponsor.js makes it (test/geo-sponsor.test.mjs
# and scripts/test_sponsor_portal.py hold the two equal).
GEO_FILE = ROOT / "data" / "geo-sponsors.json"
GEO_SURFACES = ("state-page", "reader-state")


def geo_entry(geo_id):
    try:
        d = json.loads(GEO_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for e in d.get("sponsors") or []:
        if e.get("id") == geo_id:
            return e
    return None


def geo_link(url, campaign, surface):
    """The same string components/geo-sponsor.js withUtm() builds."""
    from urllib.parse import quote
    s, h = str(url), ""
    if "#" in s:
        i = s.index("#")
        s, h = s[:i], s[i:]
    q = ("utm_source=agsist&utm_medium=sponsor&utm_campaign=" + quote(campaign, safe="-_.!~*'()") +
         "&utm_content=" + quote(surface, safe="-_.!~*'()"))
    sep = "?" if "?" not in s else ("" if s.endswith(("?", "&")) else "&")
    return s + sep + q + h


def geo_creative(geo_id):
    e = geo_entry(geo_id)
    if not e or not e.get("headline") or not e.get("body") or not str(e.get("url") or "").startswith("https://"):
        return None
    c = {"advertiser": e.get("name"), "headline": e.get("headline"), "body": e.get("body"),
         "facts": [f for f in (e.get("facts") or []) if isinstance(f, str) and f][:4],
         "cta_text": e.get("cta_text") or "Learn more", "cta_url": e.get("url"),
         "phone": e.get("phone") or None, "logo": e.get("logo") or None, "disclosure": None}
    camp = e.get("utm_campaign") or ("geo-" + e["id"])
    links = {k: geo_link(e["url"], camp, k) for k in GEO_SURFACES}
    return {
        "live": e.get("active") is True,
        "proof_code": proof_code(c),
        "fields": {k: c.get(k) for k in CREATIVE_FIELDS},
        "label": "Sponsor",
        "tier": None,
        "links": links,
        "cta_urls": dict(links),
        "previews": {},
        "states": list(e.get("states") or []),
        "slot": "geo-" + e["id"],
    }


def creative_block(slug, geo=None):
    """What this sponsor's ad says, where it points, and the code for it.

    Returns None when there is no creative on file -- a sponsor who has not
    been given one yet gets the pending page, not an empty proof.
    """
    if geo:
        return geo_creative(geo)
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


# Never written to a portal, even if someone types them into data/sponsors.json:
# every file in this repo is published, so a person's name, phone, email or
# invoice address in a portal file is public. Who to call and where invoices go
# live with Sig, in his own email, nowhere in the repo (Oct 19).
PRIVATE_BILLING_KEYS = ("invoice_contact", "invoice_to", "invoice_email", "contact", "email", "phone")


def portal_extras(s):
    """What the portal needs beyond the numbers: the approval on record and the
    contract terms. All of it is read from data/sponsors.json, typed there by
    Sig, never inferred. No contact: see PRIVATE_BILLING_KEYS.

    approved  {"proof": "xxxxxxxx", "on": "YYYY-MM-DD", "by": "name"} -- set when
              the approval email arrives. The portal shows APPROVED only when
              this proof equals the current proof code; if the copy changed
              since, it says the approval does not cover the new words.
    billing   {"tier": "daily", "trial_months": 1, "rate_lock_months": 12,
               "notes": "..."} -- the deal as agreed. The schedule on the
              portal is computed from this and the start date.
    """
    bill = s.get("billing")
    if isinstance(bill, dict):
        bill = {k: v for k, v in bill.items() if k not in PRIVATE_BILLING_KEYS} or None
    regions = s.get("regions")
    return {
        # A FREE TEST (Oct 28, 2026, RootLot): billing.free_test true. The portal
        # keeps the billing layout and shows every part about money muted, under
        # "Free test: no charge". Nothing is billed and no price is offered.
        "freeTest": bool(isinstance(bill, dict) and bill.get("free_test") is True),
        # The states a state-targeted ad is aimed at; the portal shows readers,
        # page views and engagement there (from data/audience.json) and the ad's
        # own numbers by GA4's region for the visit.
        "regions": licensed_states(regions) if regions is not None else None,
        "geo": s.get("geo") or None,
        "approval": s.get("approved") or None,
        "billing": bill or None,
        "placements": s.get("placements") or None,
        # The states this sponsor can write business in, as two-letter codes,
        # typed from the sponsor's own list. The audience section marks them on
        # the map and adds up readers inside them. Never inferred from where
        # their offices are: an agency licensed in a state with no office is
        # exactly the case this exists for.
        "licensedStates": licensed_states(s.get("licensed_states")),
        # The day Sig took the ad down, as typed in data/sponsors.json. The
        # portal's status reads "Ended <date>" instead of "Not started". Only a
        # YYYY-MM-DD day counts; anything else is treated as not ended.
        "ended": s.get("ended") if isinstance(s.get("ended"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", s.get("ended")) else None,
    }


US_CODES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
               "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV "
               "WI WY".split())


def licensed_states(v):
    """None when nobody has typed a list -- the page then says it is waiting for
    one. A code that is not a US state or DC fails the build rather than being
    dropped, because a silently shortened list undercounts the sponsor's reach."""
    if v is None:
        return None
    if not isinstance(v, list):
        fail("licensed_states must be a list of two-letter codes, got %r" % (v,))
    out = []
    for c in v:
        c = str(c).strip().upper()
        if c not in US_CODES:
            fail("licensed_states: %r is not a US state or DC code" % c)
        if c not in out:
            out.append(c)
    return sorted(out)


STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def region_ads_pending(s):
    """Before the ad runs: zero in every state, marked not started, never blank."""
    regs = licensed_states(s.get("regions")) or []
    return {"pending": True, "start": None, "through": None,
            "rows": [{"code": c, "name": STATE_NAMES[c], "viewable": 0, "clicks": 0} for c in regs],
            "elsewhere": {"viewable": 0, "clicks": 0}}


def region_ads(s, views_by_region, clicks_by_region, total_views, total_clicks, start, end):
    """The ad's viewable impressions and clicks in each of the sponsor's states,
    by GA4's region for the visit (US visits), plus everything else. GA4 rows
    with no region ("(not set)") and visits outside the US land in elsewhere,
    so the parts add up to the totals."""
    regs = licensed_states(s.get("regions")) or []
    rows, sv, sc = [], 0, 0
    for c in regs:
        n = STATE_NAMES[c]
        v, k = int(views_by_region.get(n, 0)), int(clicks_by_region.get(n, 0))
        sv += v
        sc += k
        rows.append({"code": c, "name": n, "viewable": v, "clicks": k})
    return {"pending": False, "start": start, "through": end, "rows": rows,
            "elsewhere": {"viewable": max(0, int(total_views) - sv), "clicks": max(0, int(total_clicks) - sc)}}


def other_ads_live(geo_id, today=None):
    """Every other ad that fires sponsor_viewable or a sponsor click: the daily
    sponsor, a footer supporter, a sold page ribbon, a PRF state sponsor,
    another state-targeted entry. Named, so the portal can say why."""
    day = (today or date.today()).isoformat()
    out = []

    def load(name):
        try:
            return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
    if load("sponsor.json").get("active") is True:
        out.append("the daily briefing sponsor")
    if any(x.get("active") is True for x in load("supporters.json").get("supporters") or []):
        out.append("a footer supporter")
    if any(isinstance(x, dict) and x.get("active") is not False and x.get("company") and str(x.get("start") or "9") <= day
           for x in (load("page-sponsors.json").get("slots") or {}).values()):
        out.append("a page sponsor")
    prf = load("prf-sponsors.json")
    if any(isinstance(v, dict) and v.get("name") and (not v.get("through") or v["through"] >= day)
           for k, v in prf.items() if not k.startswith("_")):
        out.append("a PRF state sponsor")
    if any(e.get("active") is True and e.get("id") != geo_id for e in load("geo-sponsors.json").get("sponsors") or []):
        out.append("another state-targeted sponsor")
    return out


# ── A DEMO PORTAL (Oct 29, 2026; Tractor Supply) ─────────────────────────
# 'demo': true in data/sponsors.json. A prospect is shown the portal they would
# get, on a private link, with AGSIST's real readers in the states picked for
# the demo. NO AD RUNS: a demo has no 'geo' id and no entry in any file that
# serves an ad, so its viewable and click counts are the not-started 0, and GA4
# is never asked for them (a demo's own numbers would be somebody else's).
# 'expires' is the demo's last day; after it the builder drops the data and
# writes only enough for the page to say the demo has ended. A demo with no
# valid expires date is treated as ended, never as open-ended.
DEMO_CREATIVE_DEFAULTS = {"headline": "Your ad here", "cta_text": "Learn more"}


def is_demo(s):
    return isinstance(s, dict) and s.get("demo") is True


def demo_ended(s, today=None):
    exp = s.get("expires")
    if not (isinstance(exp, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", exp)):
        return True
    try:
        last = date.fromisoformat(exp)
    except ValueError:
        return True
    return (today or date.today()) > last or s.get("active") is False


def demo_creative(s):
    """The placeholder ad, plain text: no logo, no phone, no facts, and a
    button that goes nowhere off this page. Never live."""
    a = s.get("demo_ad") or {}
    c = {"advertiser": a.get("advertiser") or "Your business",
         "headline": a.get("headline") or DEMO_CREATIVE_DEFAULTS["headline"],
         "body": a.get("body") or "",
         "facts": [], "cta_text": a.get("cta_text") or DEMO_CREATIVE_DEFAULTS["cta_text"],
         "cta_url": "#", "phone": None, "logo": None, "disclosure": None}
    return {"live": False, "demo": True, "proof_code": proof_code(c),
            "fields": {k: c.get(k) for k in CREATIVE_FIELDS}, "label": "Sponsor", "tier": None,
            "links": {}, "cta_urls": {}, "previews": {}, "states": licensed_states(s.get("regions")) or [],
            "slot": None}


def demo_payload(s, today=None):
    """The whole portal file for a demo. After its last day: the ended stub
    only, with no creative, no states and no numbers."""
    slug = s.get("slug")
    if demo_ended(s, today):
        return {"schema": "agsist-sponsor-report/1", "slug": slug, "demo": True,
                "demoEnded": True, "expires": s.get("expires") if isinstance(s.get("expires"), str) else None}
    ex = portal_extras(s)
    ex.update({"freeTest": False, "approval": None, "billing": None, "geo": None, "ended": None})
    return {
        "schema": "agsist-sponsor-report/1",
        "sponsor": s.get("name", slug), "slug": slug,
        "demo": True, "demoFor": s.get("demo_for") or None, "expires": s["expires"],
        "regionsNote": s.get("regions_note") or None,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "through": None, "start": None, "pending": True, "pages": None,
        "totals": {"viewable": 0, "clicks": 0, "ctr": None, "legacyImpressions": 0},
        "windows": [], "series": [], "byPage": [],
        "creative": demo_creative(s),
        "rateCard": rate_card(),
        "approveTo": APPROVE_TO,
        "regionAds": region_ads_pending(s),
        **ex,
    }


def write_demos(conf, today=None):
    """Every demo's portal file. Returns the lines to print."""
    out = []
    OUTDIR.mkdir(parents=True, exist_ok=True)
    for s in conf.get("sponsors", []):
        if not is_demo(s) or not s.get("slug") or not s.get("token"):
            continue
        p = demo_payload(s, today)
        f = OUTDIR / ("%s-%s.json" % (s["slug"], s["token"]))
        f.write_text(json.dumps(p, indent=1) + "\n", encoding="utf-8")
        out.append("%s: demo %s" % (s["slug"], "ended, data dropped" if p.get("demoEnded") else "through " + str(s.get("expires"))))
    return out


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
    # Demos first, and never in the GA4 run: no ad of theirs exists to count.
    for line in write_demos(conf):
        print("  " + line)
    sponsors = [s for s in conf.get("sponsors", []) if s.get("active", True) and not is_demo(s)]
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
            cur["creative"] = creative_block(slug_, s_.get("geo"))
            if s_.get("geo") and "regionAds" not in cur:
                cur["regionAds"] = region_ads_pending(s_)
            cur["rateCard"] = rate_card()
            cur["approveTo"] = s_.get("approve_to") or APPROVE_TO
            cur.update(portal_extras(s_))
            cur.pop("contact", None)     # an older file may still carry one; never again (Oct 19)
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
        # A CAMPAIGN THAT STARTED TODAY HAS NO FULL DAY YET (Oct 28, 2026: Root Lot went live the day the
        # change merged, so start was today and end yesterday). GA4 refuses start > end with a 400, which
        # stopped every sponsor's report. No day in range is no rows, not a question.
        if str(start) > str(end):
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

    def run_region(events, start, end):
        """{region name: count} for US visits, GA4's own region for the visit.
        Never an event parameter: the ad sends no state."""
        if not events or str(start) > str(end):
            return {}
        req = RunReportRequest(
            property="properties/" + prop,
            dimensions=[Dimension(name="region")],
            metrics=[Metric(name="eventCount")],
            date_ranges=[DateRange(start_date=start, end_date=end)],
            dimension_filter=FilterExpression(and_group=FilterExpressionList(expressions=[
                in_list("eventName", events),
                FilterExpression(filter=Filter(field_name="country",
                                               string_filter=Filter.StringFilter(value="United States")))])),
            limit=1000,
        )
        out = {}
        for r_ in client.run_report(req).rows:
            out[r_.dimension_values[0].value] = out.get(r_.dimension_values[0].value, 0) + int(r_.metric_values[0].value)
        return out

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
        # A STATE-TARGETED AD SWITCHED ON BY HAND (Oct 28, 2026: Sig said start
        # for RootLot; it goes live the day the change merges). Nobody types the
        # day it first ran, so 'count_from' (the day Sig said start; nothing of
        # it could run before) is where GA4 is asked from, and the portal's
        # "live since" is the FIRST DAY WITH DATA, found below. Until a day has
        # data the counts are 0, never blank and never another ad's.
        count_from = None
        if not start and s.get("geo") and s.get("count_from"):
            ge = geo_entry(s["geo"])
            if ge and ge.get("active") is True:
                count_from = start = s["count_from"]

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
                "creative": creative_block(slug, s.get("geo")),
                "rateCard": rate_card(),
                "approveTo": s.get("approve_to") or APPROVE_TO,
                **({"regionAds": region_ads_pending(s)} if s.get("geo") else {}),
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

        live_since = None
        if count_from:
            live_since = next((x["d"] for x in series if x["v"] or x["c"]), None)
        payload = {
            "schema": "agsist-sponsor-report/1",
            "sponsor": s.get("name", slug),
            "slug": slug,
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "through": end.isoformat(),
            "start": live_since if count_from else start,
            "countFrom": count_from,
            "liveSince": live_since if count_from else start,
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
            "creative": creative_block(slug, s.get("geo")),
            "rateCard": rate_card(),
            "approveTo": s.get("approve_to") or APPROVE_TO,
            **portal_extras(s),
        }
        if s.get("geo"):
            other = other_ads_live(s.get("geo"))
            if other:
                # GA4 cannot tell two ads apart until `slot` is registered, so
                # these counts would hold the other ad's too. Withheld, said so.
                payload["withheld"] = "Another ad is running on the site (%s), and GA4 cannot yet tell the two apart." % ", ".join(other)
                payload["totals"] = {"viewable": None, "clicks": None, "ctr": None, "legacyImpressions": 0}
                payload["windows"], payload["series"], payload["byPage"] = [], [], []
                payload["regionAds"] = {"withheld": True, "rows": []}
            else:
                reg = run_region(VIEWABLE_EVENTS, start, end.isoformat())
                regc = run_region(CLICK_EVENTS, start, end.isoformat())
                payload["regionAds"] = region_ads(s, reg, regc, tv, tc, payload["liveSince"] or start, end.isoformat())
        f = OUTDIR / ("%s-%s.json" % (slug, token))
        f.write_text(json.dumps(payload, indent=1) + "\n", encoding="utf-8")
        written.append("%s: %d viewable, %d clicks through %s" % (slug, tv, tc, end))

    for line in written:
        print("  " + line)
    print("wrote %d report(s) to %s" % (len(written), OUTDIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
