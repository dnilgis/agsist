#!/usr/bin/env python3
"""
print_of_day.py -- "Print of the day" in the Daily (Sig, Oct 22 2026): one real
Rain Print of a place with a story that day, one line on why, then "Make yours".

THE PLACE comes from the county rain files the county pages are built from
(data/rain/<st>.json, NOAA daily records through RCC-ACIS, 1991 to 2020
normals). The story rotates by the day of the year:
    0  the wettest county against normal so far this year, lower 48
    1  the driest, lower 48
    2  the wettest in the farm states (FARM_STATES)
    3  the driest in the farm states
A county counts only when its record is good enough to say it out loud:
at most MAX_MISSING unrecorded days, at least MIN_DAYS days in, a station
within MAX_MI miles, a usual year of at least MIN_USUAL inches so far, no
multi-day accumulated totals, and a published county page whose print
figure carries the same days and total (the render draws from that page's
own data; a page that does not match is skipped, never drawn from other days).
The line names how many counties passed, so "the wettest" is a rank among a
stated sample, not a claim about every place.

THE PICTURE is drawn by scripts/render_print_of_day.mjs with the county print
engine (components/rain-county-print.js, the same drawing as the county pages)
to daily/img/print-<date>.png. When the render fails the slot is left out of
the email. The email never waits on it and never fails for it.

    python3 scripts/print_of_day.py --date 2026-10-21 [--out pick.json]
    python3 scripts/print_of_day.py --compress daily/img/print-2026-10-21.png
    python3 scripts/print_of_day.py --selftest
"""
import glob
import html
import json
import os
import re
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

MAX_MISSING = 10
MIN_DAYS = 200
MAX_MI = 10.0
MIN_USUAL = 5.0
IMG_DIR = "daily/img"
SITE = "https://agsist.com"
LOWER48_SKIP = {"AK", "HI"}
FARM_STATES = {"IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS", "MI", "KY"}
STORIES = (("wettest", "lower 48"), ("driest", "lower 48"), ("wettest", "farm states"), ("driest", "farm states"))
_FIG = re.compile(r'<figure[^>]*\bid="rc-print"[^>]*>')
_ATTR = re.compile(r'\bdata-([a-z]+)="([^"]*)"')


def _md(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%b ") + str(d.day)


def page_fig(path):
    """The county page's print figure data-* fields, or None."""
    try:
        with open(path, encoding="utf-8") as f:
            m = _FIG.search(f.read())
    except OSError:
        return None
    if not m:
        return None
    return {k: html.unescape(v) for k, v in _ATTR.findall(m.group(0))}


def candidates(repo=REPO, scope="lower 48"):
    import county_rain as R
    out = []
    for p in sorted(glob.glob(os.path.join(repo, "data", "rain", "??.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        st = str(d.get("state") or "").upper()
        if st in LOWER48_SKIP or (scope == "farm states" and st not in FARM_STATES):
            continue
        state_name = R.STATES.get(st)
        for fips, c in (d.get("counties") or {}).items():
            stn = c.get("station") or {}
            if c.get("pct") is None or not isinstance(c.get("total"), (int, float)):
                continue
            if (c.get("missing") or 0) > MAX_MISSING or (c.get("days") or 0) < MIN_DAYS:
                continue
            if not isinstance(stn.get("mi"), (int, float)) or stn["mi"] > MAX_MI:
                continue
            if (c.get("usual") or 0) < MIN_USUAL or (c.get("acc") or 0) or (c.get("unsplit") or 0):
                continue
            out.append({"st": st, "fips": fips, "c": c, "state_name": state_name})
    return out


def _page_for(repo, st, state_name, county):
    import county_rain as R
    if not state_name:
        return None, None
    rel = "rain/%s/%s" % (R.slug(state_name), R.slug(county))
    return "/" + rel, os.path.join(repo, rel + ".html")


def pick(day, repo=REPO):
    """The day's print, or None (with the reason in a log line)."""
    import build_county_rain as B
    import county_rain as R
    i = day.toordinal() % len(STORIES)
    kind, scope = STORIES[i]
    cs = candidates(repo, scope)
    if not cs:
        print("print of the day: no county passed the record gates")
        return None
    cs.sort(key=lambda x: (x["c"]["pct"], x["fips"]), reverse=(kind == "wettest"))
    for x in cs[:25]:
        c, st = x["c"], x["st"]
        if str(c.get("as_of") or "") > day.isoformat():
            continue            # no look-ahead: a record dated after the issue
        url, path = _page_for(repo, st, x["state_name"], c.get("name"))
        fig = page_fig(path) if path else None
        if not fig:
            continue
        try:
            if int(fig.get("days")) != int(c["days"]) or abs(float(fig.get("total")) - float(c["total"])) > 0.011:
                continue        # the page was built from other days: never draw it from these
        except (TypeError, ValueError):
            continue
        year = int(str(c["as_of"])[:4])
        stn = c["station"]
        place = "%s, %s" % (c["name"], x["state_name"])
        n = len(cs)
        rank = "wettest" if kind == "wettest" else "driest"
        town = R.station_town(stn.get("raw") or "") if stn.get("raw") else (stn.get("name") or "")
        where = ("the %s farm-state counties we read" if scope == "farm states"
                 else "the %s counties we read in the lower 48") % format(n, ",")
        why = ("%s: %.2f in. of rain this year through %s at the %s station, %d%% of normal. "
               "The %s against normal of %s."
               % (place, c["total"], _md(c["as_of"]), town, c["pct"], rank, where))
        alt = ("Rain Print of %s, %d through %s: %.2f inches of rain, %d%% of the 1991 to 2020 normal of %.2f inches"
               % (place, year, _md(c["as_of"]), c["total"], c["pct"], c["usual"]))
        return {
            "date": day.isoformat(), "kind": kind, "scope": scope, "n": n,
            "st": st, "fips": x["fips"], "place": place, "year": year,
            "station": stn.get("name"), "station_mi": stn.get("mi"),
            "total": c["total"], "usual": c["usual"], "pct": c["pct"], "as_of": c["as_of"],
            "missing": c.get("missing") or 0, "days": c["days"],
            "why": why, "alt": alt, "page": url,
            "make_url": B.rain_print_href(c, st, year),
            "fig": fig,
            "image": "%s/print-%s.png" % (IMG_DIR, day.isoformat()),
            "source": "NOAA daily records (RCC-ACIS), normals 1991 to 2020; data/rain/%s.json" % st.lower(),
        }
    print("print of the day: none of the top %s %s counties has a matching page" % (kind, scope))
    return None


def compress(path, colors=96):
    """Quantize the PNG in place (Pillow); returns the new size in bytes."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q.save(path, optimize=True)
    return os.path.getsize(path)


def _selftest():
    bad = []

    def ok(c, m):
        if not c:
            bad.append(m)
            print("FAIL", m)
    import county_rain as R
    ok(R.slug("Adams County") == "adams-county", "slug")
    fig = page_fig(os.path.join(REPO, "rain", "iowa", "adams-county.html"))
    ok(fig and fig.get("fips") == "19003" and fig.get("st") == "ia", "reads the county page figure")
    got = 0
    for d in (date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 21), date(2026, 10, 22)):
        p = pick(d)
        if not p:
            continue        # the pages and the data can be a build apart: then that day has no print
        got += 1
        ok(p["make_url"].startswith("/rain-print?place="), "Make yours opens /rain-print with the place")
        ok("—" not in p["why"] and "—" not in p["alt"], "no em dash")
        ok(re.search(r"\d", p["alt"]) and str(p["pct"]) in p["alt"], "alt text carries the numbers")
        ok(p["as_of"] <= p["date"], "no look-ahead")
        ok(p["missing"] <= MAX_MISSING and p["station_mi"] <= MAX_MI, "record gates")
        ok(("%d%%" % p["pct"]) in p["why"] and format(p["n"], ",") in p["why"], "why names the number and the sample")
    ok(got >= 1, "a pick on at least one day")
    ok([STORIES[date(2026, 10, k).toordinal() % len(STORIES)] for k in (19, 20, 21, 22)] == list(STORIES[1:]) + [STORIES[0]]
       or len({STORIES[date(2026, 10, k).toordinal() % len(STORIES)] for k in (19, 20, 21, 22)}) == 4, "the story rotates")
    print("print_of_day selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    if "--compress" in argv:
        p = argv[argv.index("--compress") + 1]
        print("compressed %s to %d bytes" % (p, compress(p)))
        return 0
    d = date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv else date.today()
    p = pick(d)
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(p, f, indent=1)
    print(json.dumps({k: v for k, v in (p or {}).items() if k != "fig"}, indent=1) if p else "no pick")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
