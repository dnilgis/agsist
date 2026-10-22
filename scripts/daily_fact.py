#!/usr/bin/env python3
"""
daily_fact.py -- "I never knew that" in the Daily (Sig, Oct 22 2026): one fact
a day that makes a reader stop. Never invented, never unsourced.

Two kinds, rotating by the day of the year:
  ours     computed here, every day, from our own files, with the file named
           as the source:
             rain_day   the most rain any county station we read recorded in
                        one day this year (lower 48), only when another
                        county in the same state recorded at least
                        CORROBORATE of it the same day (one gauge alone can be
                        wrong), from data/rain/<st>.json
             dry_spell  the longest run of days without rain at a farm-state
                        county station this year, from data/rain/<st>.json
  pool     data/daily-facts.json: each entry has the fact, the source's name,
           a link, the date it was read, and the source's own words. An entry
           missing any of them is never picked (valid_entry).
The old unsourced quote pool (data/quote-pool.json) stays off.

    python3 scripts/daily_fact.py --date 2026-10-21
    python3 scripts/daily_fact.py --check        every pool entry has its source (exit 1 if not)
    python3 scripts/daily_fact.py --selftest
"""
import glob
import json
import os
import re
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
POOL = os.path.join(REPO, "data", "daily-facts.json")
CORROBORATE = 0.4
MAX_MISSING = 10
LOWER48_SKIP = {"AK", "HI"}
FARM_STATES = {"IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS", "MI", "KY"}
_URL = re.compile(r"^https://[a-z0-9.-]+\.[a-z]{2,}/")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STATES = None


def _states():
    global STATES
    if STATES is None:
        sys.path.insert(0, HERE)
        import county_rain as R
        STATES = R.STATES
    return STATES


def _town(c):
    stn = c.get("station") or {}
    try:
        sys.path.insert(0, HERE)
        import county_rain as R
        if stn.get("raw"):
            return R.station_town(stn["raw"])
    except Exception:
        pass
    return stn.get("name") or "the county station"


def _md(iso):
    d = date.fromisoformat(iso)
    return d.strftime("%B ") + str(d.day)


def valid_entry(x):
    """A pool entry may be shown only with all of: fact, source, an https
    link, the date it was read, and the source's own words."""
    if not isinstance(x, dict):
        return False
    need = ("id", "fact", "source", "url", "checked", "quote")
    if any(not isinstance(x.get(k), str) or not x[k].strip() for k in need):
        return False
    return bool(_URL.match(x["url"]) and _ISO.match(x["checked"]) and re.search(r"\d|\bhalf\b", x["fact"])
                and "—" not in x["fact"])


def load_pool(path=POOL):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    return [x for x in (d.get("facts") or []) if valid_entry(x)]


def _counties(repo):
    for p in sorted(glob.glob(os.path.join(repo, "data", "rain", "??.json"))):
        try:
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        st = str(d.get("state") or "").upper()
        for fips, c in (d.get("counties") or {}).items():
            if (c.get("missing") or 0) > MAX_MISSING or (c.get("acc") or 0) or (c.get("unsplit") or 0):
                continue
            yield st, fips, c, "data/rain/%s.json" % st.lower()


def rain_day(day, repo=REPO):
    rows = [(st, f, c, src) for st, f, c, src in _counties(repo)
            if st not in LOWER48_SKIP and isinstance(c.get("max_day"), list) and len(c["max_day"]) == 2
            and str(c.get("as_of") or "") <= day.isoformat()]
    by_day = {}
    for st, f, c, src in rows:
        by_day.setdefault((st, c["max_day"][0]), []).append(c["max_day"][1])
    rows.sort(key=lambda r: -float(r[2]["max_day"][1]))
    for st, f, c, src in rows[:20]:
        when, v = c["max_day"]
        others = sorted(by_day.get((st, when), []), reverse=True)[1:]
        if not others or others[0] < CORROBORATE * v:
            continue          # one gauge alone: could be a bad reading, so it is not said
        stn = _town(c)
        text = ("The most rain any county station we read got in one day this year: %.2f inches at %s, "
                "%s, %s, on %s." % (v, stn, c["name"], _states().get(st, st), _md(when)))
        return {"id": "ours-rain-day", "kind": "ours", "text": text,
                "source": "NOAA daily records via RCC-ACIS, %d county stations" % len(rows), "file": src,
                "url": None, "as_of": c.get("as_of")}
    return None


def dry_spell(day, repo=REPO):
    rows = [(st, f, c, src) for st, f, c, src in _counties(repo)
            if st in FARM_STATES and isinstance(c.get("dry"), list) and len(c["dry"]) == 3
            and str(c.get("as_of") or "") <= day.isoformat() and str(c["dry"][2]) <= day.isoformat()
            and not str(c["dry"][1]).endswith("-01-01")]   # a run from Jan 1 began last year: its length is not known
    if not rows:
        return None
    rows.sort(key=lambda r: (-int(r[2]["dry"][0]), r[1]))
    st, f, c, src = rows[0]
    n, a, b = c["dry"]
    stn = _town(c)
    text = ("The longest dry run at any farm-state county station we read this year: %d days without "
            "measurable rain or snow at %s, %s, %s, %s to %s." % (n, stn, c["name"], _states().get(st, st), _md(a), _md(b)))
    return {"id": "ours-dry-spell", "kind": "ours", "text": text,
            "source": "NOAA daily records via RCC-ACIS, %d farm-state county stations" % len(rows), "file": src,
            "url": None, "as_of": c.get("as_of")}


def for_day(day, repo=REPO, pool_path=None):
    """The day's fact: {"text", "source", "url" or None, "file" or None, "id", "kind"}, or None."""
    pool = load_pool(pool_path or os.path.join(repo, "data", "daily-facts.json"))
    ours = (rain_day, dry_spell)
    n = len(pool) + len(ours)
    if not n:
        return None
    i = day.toordinal() % n
    if i < len(ours):
        try:
            got = ours[i](day, repo)
        except Exception as ex:          # a file we cannot read: fall back to the pool
            print("daily fact: %s skipped (%s)" % (ours[i].__name__, type(ex).__name__))
            got = None
        if got:
            return got
        i = len(ours) + (day.toordinal() % max(1, len(pool)))
    if not pool:
        return None
    x = pool[(i - len(ours)) % len(pool)]
    return {"id": x["id"], "kind": "pool", "text": x["fact"], "source": x["source"], "url": x["url"],
            "file": None, "checked": x["checked"]}


def _selftest():
    bad = []

    def ok(c, m):
        if not c:
            bad.append(m)
            print("FAIL", m)
    pool = load_pool()
    with open(POOL, encoding="utf-8") as f:
        raw = json.load(f)["facts"]
    ok(len(pool) == len(raw) and len(pool) >= 10, "every pool entry is valid (%d of %d)" % (len(pool), len(raw)))
    ok(len({x["id"] for x in raw}) == len(raw), "pool ids unique")
    for k in ("source", "url", "checked", "quote"):
        ok(not valid_entry(dict(raw[0], **{k: ""})), "an entry with no %s is never shown" % k)
    ok(not valid_entry(dict(raw[0], url="http://x.example/")), "https only")
    ok(not valid_entry(dict(raw[0], fact="Something nice about farming.")), "a fact carries a number")
    seen = set()
    for k in range(40):
        d = date(2026, 10, 1).fromordinal(date(2026, 10, 1).toordinal() + k)
        f = for_day(d)
        ok(f and f.get("text") and f.get("source") and (f.get("url") or f.get("file")), "a sourced fact on %s" % d)
        ok("—" not in (f or {}).get("text", ""), "no em dash")
        seen.add((f or {}).get("id"))
    ok("ours-rain-day" in seen and "ours-dry-spell" in seen and len(seen) >= 10, "rotates through ours and the pool")
    r = rain_day(date(2026, 10, 21))
    ok(r and re.search(r"\d+\.\d\d inches", r["text"]) and r["file"].startswith("data/rain/"), "our rain day names its file")
    print("daily_fact selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    if "--check" in argv:
        with open(POOL, encoding="utf-8") as f:
            raw = json.load(f).get("facts") or []
        badones = [str(x.get("id")) for x in raw if not valid_entry(x)]
        print("daily facts pool: %d entries, %d without a full source" % (len(raw), len(badones)))
        for b in badones:
            print("  missing source fields: " + b)
        return 1 if badones else 0
    d = date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv else date.today()
    print(json.dumps(for_day(d), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
