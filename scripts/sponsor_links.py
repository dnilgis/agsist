#!/usr/bin/env python3
"""
THE ONE DEFINITION OF A TAGGED SPONSOR LINK.

A sponsor's destination is rendered on four surfaces -- the homepage block, the
archive page, the subscriber email's HTML part and its plain-text part -- and
every one of them used to be free to append whatever it liked. data/sponsor.json
shipped on 2026-09-13 with the parameters written INTO cta_url, which meant the
email would have inherited utm_medium=daily_briefing and reported inbox clicks
as page clicks.

A sponsor checks these against their own analytics. Two surfaces disagreeing
about which is which is the fastest way to lose the only number they can verify
independently.

So: sponsor.json holds the BARE url, and every renderer asks this module.

    tag("https://aigwi.com/", "daily_email", "apex")
    -> https://aigwi.com/?utm_source=agsist&utm_medium=daily_email
       &utm_campaign=sponsor-apex

RULES THAT MATTER

  * An existing query string is preserved, and a parameter the sponsor set
    themselves WINS. If Rich sends us a link that already carries
    utm_campaign=fall-push, that is his campaign and we do not overwrite it.
  * Only http(s). A mailto: or tel: destination comes back untouched -- there
    is nothing to tag and appending a query to a mailto breaks it.
  * Fragments survive: the parameters go before the #, where they belong.
  * Idempotent. Tagging a tagged url changes nothing, so a double-render or a
    re-bake cannot stack parameters.

python3 scripts/sponsor_links.py --selftest
"""
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

SOURCE = "agsist"

# The surface a click came from. These strings end up in the sponsor's own
# analytics, so they are plain English and they do not change once a campaign
# has run under them -- renaming one silently splits a sponsor's history in two.
SURFACES = {
    "homepage": "homepage",
    "daily_page": "daily_page",  # the live /daily page -- its own placement, added 2026-09-20
    "archive": "archive",
    "daily_email": "daily_email",
    "rss": "rss",
    "report": "report",          # the link shown in the sponsor's own portal
}


def campaign(slug):
    return "sponsor-%s" % (slug or "unknown")


def tag(url, surface, slug):
    """A sponsor url with AGSIST's attribution on it. See the module docstring."""
    if not url or not isinstance(url, str):
        return url
    medium = SURFACES.get(surface)
    if medium is None:
        raise ValueError("unknown surface %r -- add it to SURFACES deliberately" % surface)
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return url          # mailto:, tel:, anything else: nothing to tag
    q = parse_qsl(parts.query, keep_blank_values=True)
    have = {k for k, _ in q}
    for k, v in (("utm_source", SOURCE), ("utm_medium", medium),
                 ("utm_campaign", campaign(slug))):
        if k not in have:               # the sponsor's own value wins
            q.append((k, v))
    return urlunsplit((parts.scheme, parts.netloc, parts.path,
                       urlencode(q, doseq=True), parts.fragment))


def all_surfaces(url, slug):
    """{surface: tagged url} for every surface, for the sponsor's portal.

    The portal shows these so a sponsor can paste them into their own analytics
    and match our count against theirs, rather than taking our number on faith.
    """
    return {s: tag(url, s, slug) for s in SURFACES}


def _selftest():
    P = F = 0

    def chk(cond, name, detail=""):
        nonlocal P, F
        if cond:
            P += 1
            print("  ok    " + name)
        else:
            F += 1
            print("  FAIL  " + name + (("  [" + str(detail) + "]") if detail else ""))

    u = "https://aigwi.com/"
    t = tag(u, "daily_email", "apex")
    chk("utm_source=agsist" in t and "utm_medium=daily_email" in t
        and "utm_campaign=sponsor-apex" in t, "a bare url gets all three", t)

    chk(tag(u, "homepage", "apex") != tag(u, "daily_email", "apex"),
        "the surfaces are distinguishable in the sponsor's own analytics")

    chk(tag(t, "daily_email", "apex") == t,
        "tagging a tagged url changes nothing", tag(t, "daily_email", "apex"))

    own = "https://aigwi.com/farm?utm_campaign=fall-push"
    ot = tag(own, "homepage", "apex")
    chk("utm_campaign=fall-push" in ot and "sponsor-apex" not in ot,
        "the sponsor's own campaign wins", ot)
    chk("utm_source=agsist" in ot, "...and the parameters they did not set are still added")

    keep = "https://aigwi.com/quote?ref=abc"
    kt = tag(keep, "archive", "apex")
    chk("ref=abc" in kt, "an existing query string survives", kt)

    frag = "https://aigwi.com/farm#quote"
    ft = tag(frag, "homepage", "apex")
    chk(ft.endswith("#quote") and "utm_source" in ft,
        "the fragment stays at the end", ft)

    chk(tag("mailto:info@aigwi.com", "homepage", "apex") == "mailto:info@aigwi.com",
        "a mailto is left alone")
    chk(tag("tel:+17155685050", "homepage", "apex") == "tel:+17155685050",
        "so is a tel")
    chk(tag("", "homepage", "apex") == "" and tag(None, "homepage", "apex") is None,
        "empty and None survive without raising")

    try:
        tag(u, "billboard", "apex")
        chk(False, "an unknown surface raises rather than guessing a medium")
    except ValueError:
        chk(True, "an unknown surface raises rather than guessing a medium")

    a = all_surfaces(u, "apex")
    chk(set(a) == set(SURFACES) and len(set(a.values())) == len(SURFACES),
        "all_surfaces returns one distinct url per surface", a)

    print()
    print("sponsor_links selftest: %d passed, %d failed" % (P, F))
    return 1 if F else 0


if __name__ == "__main__":
    raise SystemExit(_selftest() if "--selftest" in sys.argv else
                     print("\n".join("%-12s %s" % (k, v) for k, v in
                                     all_surfaces("https://example.com/", "demo").items())) or 0)
