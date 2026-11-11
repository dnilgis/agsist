#!/usr/bin/env python3
"""
THE AUDIENCE NUMBERS ON THE SPONSOR PAGES, WRITTEN INTO THE HTML (Oct 29, 2026).

sponsor.html and sponsor-kit.html used to be typed with one set of figures and
fixed in the browser by a script. Crawlers, link previews and readers without
JavaScript saw the typed set: on Oct 29 the page still said 14,928 views and 155
subscribers when data/audience.json said 17,304 and 186. Now every figure sits in
a <span data-a="KEY">...</span> and this writes the current value into it from
data/audience.json, one dated set for both pages. National numbers only: a
state's readers are never written into these spans.

    engaged         GA4 engaged readers, the 28-day window (the number every sponsor
                    sign prints)

    views, users    GA4 page views and readers, the 28-day window
    win             that window, "Sep 29 to Oct 26, 2026"
    cash, home      GA4 views of /cash-bids and of the homepage in that window
    subs, subsAsOf  email subscribers to the Daily, and the day they were counted
    elev            elevators with a current bid (data/elevator-counts.json, not an
                    audience number; it moves through the day and is not --checked)

A key whose source is missing keeps the text it has. The page scripts still
refresh the same spans on load, from the same file.

It also writes data/sponsor-spots.json (Nov 11, 2026): the numbers the open
sponsor spots print, so a page reads one small file instead of the two audience
files. Sitewide: engaged readers and views, 28 days. Each state: its engaged
readers (readers whose visit is in that state, data/audience.json) and the views
of pages about that state (data/audience-pages.json, the paths the state card
shows on). The home state's numbers are withheld: they include our own visits.

    python3 scripts/bake_audience.py            rewrite the spans
    python3 scripts/bake_audience.py --check    exit 1 if a page or data/sponsor-spots.json is behind
    python3 scripts/bake_audience.py --selftest offline checks
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("sponsor.html",)
SPOTS = ROOT / "data" / "sponsor-spots.json"
WINDOW = "28d"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SPAN = re.compile(r'(<span data-a="([A-Za-z0-9]+)">)([^<]*)(</span>)')
# Keys the stale check holds to data/audience.json. elev is a site figure that moves all day.
CHECKED = ("views", "users", "engaged", "win", "cash", "home", "subs", "subsAsOf")


def day(s, year=True):
    p = str(s or "").split("-")
    if len(p) != 3:
        return ""
    return "%s %d" % (MON[int(p[1]) - 1], int(p[2])) + (", " + p[0] if year else "")


def span(a, b):
    if str(a)[:4] == str(b)[:4]:
        return "%s to %s" % (day(a, False), day(b))
    return "%s to %s" % (day(a), day(b))


def n(x):
    return "{:,}".format(int(x))


def values(aud, counts=None):
    """{key: text} for every key the files can answer. Nothing is guessed: a missing
    figure is left out and the page keeps what it has."""
    v = {}
    tot = ((aud or {}).get("totals") or {}).get(WINDOW) or {}
    if tot.get("views"):
        v["views"] = n(tot["views"])
    if tot.get("users"):
        v["users"] = n(tot["users"])
    if tot.get("engaged"):
        v["engaged"] = n(tot["engaged"])
    w = next((r for r in (aud or {}).get("ranges") or [] if r.get("id") == WINDOW), None)
    if w and w.get("start") and w.get("end"):
        v["win"] = span(w["start"], w["end"])
    pages = {p.get("path"): p.get("views") for p in ((aud or {}).get("pages") or {}).get(WINDOW) or []}
    if pages.get("/cash-bids"):
        v["cash"] = n(pages["/cash-bids"])
    if pages.get("/"):
        v["home"] = n(pages["/"])
    em = (aud or {}).get("email") or {}
    if em.get("subscribers") and em.get("asOf"):
        v["subs"] = n(em["subscribers"])
        v["subsAsOf"] = day(em["asOf"])
    el = ((counts or {}).get("bids") or {}).get("elevators")
    if el:
        v["elev"] = n(el)
    return v


def bake(text, vals):
    return SPAN.sub(lambda m: m.group(1) + (vals[m.group(2)] if m.group(2) in vals else m.group(3)) + m.group(4), text)


def stale(text, vals):
    """[(key, on the page, in the file)] for every checked span that is behind."""
    out = []
    for m in SPAN.finditer(text):
        k = m.group(2)
        if k in CHECKED and k in vals and m.group(3) != vals[k]:
            out.append((k, m.group(3), vals[k]))
    return out


def load():
    aud = json.loads((ROOT / "data" / "audience.json").read_text())
    try:
        counts = json.loads((ROOT / "data" / "elevator-counts.json").read_text())
    except (OSError, ValueError):
        counts = None
    return values(aud, counts)


# The pages the state card shows on, by section (components/geo-sponsor.js SECTIONS).
STATE_PATH = re.compile(r"^/(?:rain|prf|arc-plc|farmland-atlas|rent|yield|hail-map|cash-bids)/([a-z-]+?)(?:\.html|/|$)")
STATE_SLUGS = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
    "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new-hampshire": "NH", "new-jersey": "NJ", "new-mexico": "NM", "new-york": "NY", "north-carolina": "NC",
    "north-dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode-island": "RI", "south-carolina": "SC", "south-dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west-virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY"}


def spots(aud, pages):
    """The numbers the open sponsor spots print (data/sponsor-spots.json). Pure.
    A figure the files do not hold is left out; the spot then prints no number."""
    aud, pages = aud or {}, pages or {}
    tot = (aud.get("totals") or {}).get(WINDOW) or {}
    w = next((r for r in aud.get("ranges") or [] if r.get("id") == WINDOW), None) or {}
    site = {}
    if isinstance(tot.get("engaged"), int) and tot["engaged"] > 0:
        site["readers"] = tot["engaged"]
    if isinstance(tot.get("views"), int) and tot["views"] > 0:
        site["views"] = tot["views"]
    cols = pages.get("cols") or []
    views = {}
    if "path" in cols and "views28" in cols:
        ip, iv = cols.index("path"), cols.index("views28")
        for r in pages.get("rows") or []:
            m = STATE_PATH.match(str(r[ip]))
            if m and m.group(1) in STATE_SLUGS and isinstance(r[iv], int):
                views[STATE_SLUGS[m.group(1)]] = views.get(STATE_SLUGS[m.group(1)], 0) + r[iv]
    readers = {x.get("code"): x.get("engaged") for x in (aud.get("states") or {}).get(WINDOW) or []}
    home = aud.get("homeState")
    states = {}
    for slug, code in sorted(STATE_SLUGS.items(), key=lambda kv: kv[1]):
        e = {"slug": slug}
        if code == home:
            e["withheld"] = "home state: the numbers include our own visits"
        else:
            if isinstance(readers.get(code), int) and readers[code] > 0:
                e["readers"] = readers[code]
            if views.get(code):
                e["views"] = views[code]
        states[code] = e
    return {"_": "The numbers the open sponsor spots print. Written by scripts/bake_audience.py from data/audience.json "
                 "and data/audience-pages.json; do not edit by hand. readers: engaged readers in the window (a state: "
                 "readers whose visit is in that state). views: page views (a state: views of pages about that state).",
            "window": {"start": w.get("start"), "end": w.get("end")} if w.get("start") else None,
            "sitewide": site, "states": states}


def spots_text(aud, pages):
    return json.dumps(spots(aud, pages), indent=1, sort_keys=False) + "\n"


def load_spots_text():
    aud = json.loads((ROOT / "data" / "audience.json").read_text())
    try:
        pages = json.loads((ROOT / "data" / "audience-pages.json").read_text())
    except (OSError, ValueError):
        pages = None
    return spots_text(aud, pages)


def selftest():
    bad = []

    def ck(name, ok):
        print(("  ok    " if ok else "  FAIL  ") + name)
        if not ok:
            bad.append(name)

    aud = {"totals": {"28d": {"views": 17304, "users": 7760}},
           "ranges": [{"id": "28d", "start": "2026-09-29", "end": "2026-10-26"}],
           "pages": {"28d": [{"path": "/cash-bids", "views": 1977}, {"path": "/", "views": 1904}]},
           "email": {"subscribers": 186, "asOf": "2026-10-28"},
           "states": {"28d": [{"name": "Iowa", "users": 331}]}}
    v = values(aud, {"bids": {"elevators": 2146}})
    ck("28-day figures", v["views"] == "17,304" and v["users"] == "7,760" and v["cash"] == "1,977" and v["home"] == "1,904")
    ck("the window in words", v["win"] == "Sep 29 to Oct 26, 2026")
    ck("a window across New Year names both years", span("2025-12-30", "2026-01-26") == "Dec 30, 2025 to Jan 26, 2026")
    ck("subscribers with their day", v["subs"] == "186" and v["subsAsOf"] == "Oct 28, 2026")
    ck("no state figure or state list reaches a public page", not any("Iowa" in x or "331" in x for x in v.values()))
    ck("elevators from the counts file", v["elev"] == "2,146")
    ck("a missing figure is left out, not guessed", values({}) == {})
    page = '<b><span data-a="views">14,928</span></b> <span data-a="subs">155</span> <span data-a="nope">x</span>'
    out = bake(page, v)
    ck("bake writes the figures and leaves unknown keys", out == '<b><span data-a="views">17,304</span></b> <span data-a="subs">186</span> <span data-a="nope">x</span>')
    ck("the stale check names what is behind", [x[0] for x in stale(page, v)] == ["views", "subs"] and stale(out, v) == [])
    ck("elev is not held to the minute", stale('<span data-a="elev">1,750</span>', v) == [])
    aud2 = {"totals": {"28d": {"views": 24928, "users": 12371, "engaged": 9418}}, "homeState": "WI",
            "ranges": [{"id": "28d", "start": "2026-10-12", "end": "2026-11-08"}],
            "states": {"28d": [{"code": "IA", "engaged": 335}, {"code": "WI", "engaged": 653}]}}
    pg = {"cols": ["path", "users28", "views28"], "rows": [["/cash-bids/iowa", 50, 70], ["/rent/iowa", 9, 12],
          ["/cash-bids/iowa/ackley", 1, 2], ["/rain/iowa/story-county", 3, 4], ["/cash-bids", 900, 2000],
          ["/rent/wisconsin", 40, 50], ["/rent/", 5, 6]]}
    sp = spots(aud2, pg)
    ck("sitewide spot: engaged readers and views", sp["sitewide"] == {"readers": 9418, "views": 24928} and v.get("engaged") is None)
    ck("a state's spot: readers in the state, views of its pages", sp["states"]["IA"] == {"slug": "iowa", "readers": 335, "views": 88})
    ck("the home state is withheld", "readers" not in sp["states"]["WI"] and "views" not in sp["states"]["WI"] and sp["states"]["WI"]["withheld"])
    ck("a state with no figures prints none", sp["states"]["OH"] == {"slug": "ohio"})
    ck("no audience file, no figures", spots({}, None)["sitewide"] == {} and spots({}, None)["window"] is None)
    ck("engaged readers reach the engaged span", values(aud2)["engaged"] == "9,418")
    if bad:
        print("selftest FAILED: " + "; ".join(bad))
        return 1
    print("selftest: all passed")
    return 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    check = "--check" in sys.argv
    vals = load()
    behind, wrote = [], []
    for name in PAGES:
        p = ROOT / name
        s = p.read_text(encoding="utf-8")
        if check:
            behind += ["%s %s: page %r, file %r" % (name, k, a, b) for k, a, b in stale(s, vals)]
            continue
        new = bake(s, vals)
        if new != s:
            p.write_text(new, encoding="utf-8")
            wrote.append(name)
    want = load_spots_text()
    have = SPOTS.read_text() if SPOTS.exists() else ""
    if want != have:
        if check:
            behind.append("data/sponsor-spots.json")
        else:
            SPOTS.write_text(want)
            wrote.append("data/sponsor-spots.json")
    if check:
        print("audience figures: %s" % ("in step with data/audience.json" if not behind else "behind: " + "; ".join(behind)))
        return 1 if behind else 0
    print("audience figures: rewrote %s" % (", ".join(wrote) or "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
