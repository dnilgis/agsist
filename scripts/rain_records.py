#!/usr/bin/env python3
"""rain_records.py: counties at or near their wettest or driest year to date on record.

Reads data/rain/<st>.json (the page totals) and data/rain/context/<st>.json (the "on record"
rank from scripts/fetch_rain_context.py). Only counties whose context is from the same fetch as
the state file, and only ranks fetch_rain_context.py already accepted (30+ counted years, years
over 5% missed days left out, this year's total equal to the page's).

For outreach and the email: a list a reporter or reader can check against the county page.

  python3 scripts/rain_records.py                   every state, top or bottom 3, markdown
  python3 scripts/rain_records.py --states WI,MN    some states
  python3 scripts/rain_records.py --within 1        records only
  python3 scripts/rain_records.py --json out.json   the same rows as JSON
  python3 scripts/rain_records.py --selftest
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAIN = os.path.join(ROOT, "data", "rain")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def rows(rain=RAIN, states=None, within=3):
    out = []
    for p in sorted(glob.glob(os.path.join(rain, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        st = d.get("state")
        if not st or (states and st not in states):
            continue
        cp = os.path.join(rain, "context", st.lower() + ".json")
        if not os.path.exists(cp):
            continue
        x = json.load(open(cp, encoding="utf-8"))
        if x.get("fetched") != d.get("fetched"):
            continue
        for f, cx in (x.get("counties") or {}).items():
            r, c = cx.get("rank"), d["counties"].get(f)
            if not r or not c:
                continue
            for side, k in (("wettest", "wetter"), ("driest", "drier")):
                place = r[k] + 1
                if place <= within:
                    g = cx.get("grid") or {}
                    gp = round(100 * g["total"] / g["usual"]) if g.get("usual") and g["usual"] >= 1 else None
                    out.append({"state": st, "fips": f, "county": c["name"], "side": side, "place": place, "years": r["n"],
                                "first": r["first"], "total": c["total"], "pct": c.get("pct"), "as_of": c["as_of"],
                                "station": (c.get("station") or {}).get("name"), "county_pct": gp,
                                # one gauge, not the county: the station and the PRISM county average 25+ points apart
                                "one_gauge": gp is not None and c.get("pct") is not None and abs(gp - c["pct"]) >= 25})
    out.sort(key=lambda o: (o["place"], o["side"], o["state"], o["county"]))
    return out


def markdown(rs):
    if not rs:
        return "No county is within that many places of its record today."
    lines = ["| County | | Rain so far | % of usual | County average | Station | Through |", "|---|---|---|---|---|---|---|"]
    for o in rs:
        rank = ("record " + o["side"]) if o["place"] == 1 else f"{ordinal(o['place'])} {o['side']}"
        lines.append(f"| {o['county']}, {o['state']} | {rank} of {o['years']} years ({o['first']} on) | {o['total']:.2f} in. | "
                     f"{'' if o['pct'] is None else str(o['pct']) + '%'} | {'' if o['county_pct'] is None else str(o['county_pct']) + '%'}{' (one gauge, not the county)' if o['one_gauge'] else ''} | {o['station'] or ''} | {o['as_of']} |")
    return "\n".join(lines)


def selftest():
    import tempfile
    fails = []
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "context"))
        json.dump({"state": "WI", "fetched": "a", "counties": {
            "55005": {"name": "Barron County", "total": 28.05, "pct": 94, "as_of": "2026-10-22", "station": {"name": "Cumberland"}},
            "55003": {"name": "Ashland County", "total": 40.0, "pct": 130, "as_of": "2026-10-22", "station": {"name": "Ashland"}},
            "55007": {"name": "Bayfield County", "total": 12.0, "pct": 50, "as_of": "2026-10-22", "station": {"name": "X"}}}},
            open(os.path.join(t, "wi.json"), "w"))
        ctx = {"state": "WI", "fetched": "a", "counties": {
            "55005": {"rank": {"n": 88, "first": 1932, "wetter": 48, "drier": 39}},
            "55003": {"rank": {"n": 60, "first": 1966, "wetter": 0, "drier": 59}, "grid": {"total": 30.0, "usual": 30.0}},
            "55007": {"rank": {"n": 40, "first": 1986, "wetter": 38, "drier": 1}}}}
        json.dump(ctx, open(os.path.join(t, "context", "wi.json"), "w"))
        rs = rows(t)
        if [(o["county"], o["side"], o["place"]) for o in rs] != [("Ashland County", "wettest", 1), ("Bayfield County", "driest", 2)]:
            fails.append(f"rows {rs}")
        if "record wettest of 60 years (1966 on)" not in markdown(rs):
            fails.append("markdown")
        if not rs[0]["one_gauge"] or "100% (one gauge, not the county)" not in markdown(rs):
            fails.append("one gauge flag")
        if rows(t, within=1) != rs[:1]:
            fails.append("within 1")
        ctx["fetched"] = "b"
        json.dump(ctx, open(os.path.join(t, "context", "wi.json"), "w"))
        if rows(t):
            fails.append("a stale context file is not read")
    print("rain_records selftest:", "ok" if not fails else "FAIL " + "; ".join(fails))
    return 1 if fails else 0


def main(argv):
    def arg(k):
        return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else None
    if "--selftest" in argv:
        return selftest()
    states = {s.strip().upper() for s in (arg("--states") or "").split(",") if s.strip()} or None
    rs = rows(states=states, within=int(arg("--within") or 3))
    if arg("--json"):
        json.dump(rs, open(arg("--json"), "w", encoding="utf-8"), indent=1)
    print(markdown(rs))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
