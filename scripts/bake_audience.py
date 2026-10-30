#!/usr/bin/env python3
"""
THE AUDIENCE NUMBERS ON THE SPONSOR PAGES, WRITTEN INTO THE HTML (Oct 29, 2026).

sponsor.html and sponsor-kit.html used to be typed with one set of figures and
fixed in the browser by a script. Crawlers, link previews and readers without
JavaScript saw the typed set: on Oct 29 the page still said 14,928 views and 155
subscribers when data/audience.json said 17,304 and 186. Now every figure sits in
a <span data-a="KEY">...</span> and this writes the current value into it from
data/audience.json, one dated set for both pages. National numbers only: a
state's readers go in private proposals, never here (standing rule).

    views, users    GA4 page views and readers, the 28-day window
    win             that window, "Sep 29 to Oct 26, 2026"
    cash, home      GA4 views of /cash-bids and of the homepage in that window
    subs, subsAsOf  email subscribers to the Daily, and the day they were counted
    elev            elevators with a current bid (data/elevator-counts.json, not an
                    audience number; it moves through the day and is not --checked)

A key whose source is missing keeps the text it has. The page scripts still
refresh the same spans on load, from the same file.

    python3 scripts/bake_audience.py            rewrite the spans
    python3 scripts/bake_audience.py --check    exit 1 if a page is behind data/audience.json
    python3 scripts/bake_audience.py --selftest offline checks
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ("sponsor.html", "sponsor-kit.html")
WINDOW = "28d"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
SPAN = re.compile(r'(<span data-a="([A-Za-z0-9]+)">)([^<]*)(</span>)')
# Keys the stale check holds to data/audience.json. elev is a site figure that moves all day.
CHECKED = ("views", "users", "win", "cash", "home", "subs", "subsAsOf")


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
    if check:
        print("audience figures: %s" % ("in step with data/audience.json" if not behind else "behind: " + "; ".join(behind)))
        return 1 if behind else 0
    print("audience figures: rewrote %s" % (", ".join(wrote) or "nothing"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
