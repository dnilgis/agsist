#!/usr/bin/env python3
"""Build data/audience.json -- who reads AGSIST -- from the analytics exports.

    python3 scripts/audience_from_exports.py \
        --country  Demographic_details_Country.csv \
        --region   Demographic_details_Region.csv \
        --google   Google_organic_search_traffic_Landing_page.csv \
        --bing     agsist.com_SearchPerformanceOverview_All.csv \
        --ai       agsist.com_AIPerformanceOverviewStats.csv

    python3 scripts/audience_from_exports.py --selftest

WHY EXPORTS AND NOT THE API. build_sponsor_report.py reads GA4 through its
reporting API once GA4_PROPERTY_ID and GA4_SERVICE_ACCOUNT are set. They are not
set, and a sponsor asked "how many readers, and in which states" today. These are
the same numbers GA4 shows in its own reports, exported by hand, with the window
and the report name carried next to every figure so nobody has to take them on
trust. When the API is connected this file can be written by the builder
instead and the page does not change.

WHAT IS LEFT OUT, AND HOW THAT IS DECIDED.

  * Everything outside the United States. Singapore alone is about a quarter of
    the property's raw "active users" and averages two seconds each -- automated
    traffic, not readers. The page quotes US readers only.

  * Nothing is subtracted from a state. A state is FLAGGED, not cut, when its
    readers average under FLAG_SECONDS of engagement across at least FLAG_MIN
    readers. That is where data-centre towns show up -- Ashburn and Boydton in
    Virginia, The Dalles in Oregon. The export is by region, not by city, so the
    server share of a flagged state cannot be measured from it, and a number
    that cannot be measured is not printed. The rule and the national average
    are printed beside the table.

STATES ARE RANKED BY ENGAGED VISITS, NOT BY ACTIVE USERS. An engaged session is
GA4's own definition -- ten seconds or longer, two or more pages, or a key
event. It is less exposed to automated traffic than a raw user count, not free
of it: Singapore logged 1,706 engaged sessions at two seconds a user. Virginia
is second by active users and twentieth by engaged visits (2026-01-01 to
09-22).

A reader who connects from two states counts once in each, so the state rows
add up to more than the national total. The page says so.
"""
import csv
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "audience.json"

FLAG_SECONDS = 40
FLAG_MIN = 50

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

# AGSIST is run from Chetek, Wisconsin, so the site's own working visits are
# inside Wisconsin's row. Their size is not in the export and is not guessed
# at; the row says so instead.
HOME_STATE = "WI"


def ga4_table(path):
    """A GA4 export: '#' comment header carrying the window, then a CSV table.
    Returns (start, end, header, rows). Only the FIRST table in the file is read."""
    start = end = None
    body = []
    for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
        if line.startswith("#"):
            if "Start date:" in line and start is None:
                start = line.split(":", 1)[1].strip()
            elif "End date:" in line and end is None:
                end = line.split(":", 1)[1].strip()
            elif body:
                break
            continue
        if not line.strip():
            if body:
                break
            continue
        body.append(line)
    rows = list(csv.reader(io.StringIO("\n".join(body))))
    iso = lambda s: s and "%s-%s-%s" % (s[:4], s[4:6], s[6:8])
    return iso(start), iso(end), rows[0], rows[1:]


def bing_daily(path):
    """Bing Webmaster daily export: "Date","Clicks","Impressions",... or
    "Date","Citations","Cited Pages". Returns [(date, a, b), ...] sorted."""
    rows = list(csv.reader(io.StringIO(Path(path).read_text(encoding="utf-8-sig"))))
    out = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        d = datetime.strptime(r[0].split()[0], "%m/%d/%Y").date()
        out.append((d, int(r[1]), int(r[2])))
    return sorted(out)


def col(header, name):
    try:
        return header.index(name)
    except ValueError:
        raise SystemExit("column %r not in %s" % (name, header))


def build(country, region, google=None, bing=None, ai=None, today=None):
    out = {"schema": "agsist-audience/1",
           "built": (today or datetime.now(timezone.utc)).isoformat(timespec="seconds") if not isinstance(today, str) else today}

    # ── US readers ──
    s, e, h, rows = ga4_table(country)
    iu, ie, ir, it = (col(h, "Active users"), col(h, "Engaged sessions"),
                      col(h, "Engagement rate"), col(h, "Average engagement time per active user"))
    ik = col(h, "Key events")
    by = {r[0]: r for r in rows}
    us = by.get("United States")
    if not us:
        raise SystemExit("no United States row in the country export")
    raw_total = sum(int(r[iu]) for r in rows)
    sg = by.get("Singapore")
    out["readers"] = {
        "source": "GA4 · Demographic details: Country",
        "start": s, "end": e,
        "us": int(us[iu]),
        "engaged": int(us[ie]),
        "engagementRate": round(float(us[ir]), 3),
        "avgSeconds": round(float(us[it]), 1),
        "keyEvents": int(us[ik]),
        "allCountries": raw_total,
        "left_out": ({"country": "Singapore", "users": int(sg[iu]), "avgSeconds": round(float(sg[it]), 1)}
                     if sg else None),
    }
    national = float(us[it])

    # ── states ──
    s2, e2, h, rows = ga4_table(region)
    iu, ie, ir, it = (col(h, "Active users"), col(h, "Engaged sessions"),
                      col(h, "Engagement rate"), col(h, "Average engagement time per active user"))
    seen = {}
    for r in rows:
        name = r[0]
        if name not in STATES:
            continue
        if name in seen:
            raise SystemExit("region %r appears twice -- a non-US region shares a state's name" % name)
        users, sec = int(r[iu]), float(r[it])
        row = {"code": STATES[name], "name": name, "users": users, "engaged": int(r[ie]),
               "engagementRate": round(float(r[ir]), 3), "avgSeconds": round(sec, 1)}
        if users >= FLAG_MIN and sec < FLAG_SECONDS:
            row["flag"] = "server"
        if STATES[name] == HOME_STATE:
            row["flag"] = "home"
        seen[name] = row
    missing = sorted(set(STATES) - set(seen))
    srows = sorted(seen.values(), key=lambda x: (-x["engaged"], -x["users"], x["code"]))
    # The home state is shown and NOT ranked: 2.6 engaged sessions a reader
    # against about 1.0 nationally is the site's own work on itself, and ranking
    # it would put it second on a sponsor's page on the strength of our visits.
    n = 0
    for x in srows:
        if x.get("flag") == "home":
            x["rank"] = None
        else:
            n += 1
            x["rank"] = n
    out["states"] = {
        "source": "GA4 · Demographic details: Region",
        "start": s2, "end": e2,
        "rankedBy": "engaged",
        "flagRule": {"seconds": FLAG_SECONDS, "minReaders": FLAG_MIN,
                     "nationalAvgSeconds": round(national, 1)},
        "homeState": HOME_STATE,
        "rowsSumUsers": sum(x["users"] for x in srows),
        "rowsSumEngaged": sum(x["engaged"] for x in srows),
        "withReaders": sum(1 for x in srows if x["users"] > 0),
        "missing": missing,
        "rows": srows,
    }

    # ── search ──
    search = {}
    if google:
        s3, e3, h, rows = ga4_table(google)
        ic, ii = col(h, "Organic Google Search clicks"), col(h, "Organic Google Search impressions")
        search["google"] = {"source": "GA4 · Search Console: landing pages", "start": s3, "end": e3,
                            "clicks": sum(int(r[ic]) for r in rows if r[ic].isdigit()),
                            "impressions": sum(int(r[ii]) for r in rows if r[ii].isdigit())}
    if bing:
        d = bing_daily(bing)
        last = d[-30:]
        search["bing"] = {"source": "Bing Webmaster · Search performance",
                          "start": last[0][0].isoformat(), "end": last[-1][0].isoformat(), "days": len(last),
                          "clicks": sum(x[1] for x in last), "impressions": sum(x[2] for x in last)}
    if search:
        out["search"] = search

    if ai:
        d = bing_daily(ai)
        last, first = d[-30:], d[:30]
        out["ai"] = {"source": "Bing Webmaster · AI Performance (Copilot and Bing answers)",
                     "start": last[0][0].isoformat(), "end": last[-1][0].isoformat(), "days": len(last),
                     "citations": sum(x[1] for x in last),
                     "perDay": round(sum(x[1] for x in last) / len(last)),
                     "earlier": {"start": first[0][0].isoformat(), "end": first[-1][0].isoformat(),
                                 "perDay": round(sum(x[1] for x in first) / len(first))},
                     "maxPagesOneDay": max(x[2] for x in d)}
    return out


def selftest():
    import tempfile
    ok = True

    def t(cond, name):
        nonlocal ok
        print(("  ok    " if cond else "  FAIL  ") + name)
        ok = ok and cond

    hdr = ("Active users,New users,Engaged sessions,Engagement rate,Engaged sessions per active user,"
           "Average engagement time per active user,Event count,Key events,User key event rate,Total revenue")
    head = "# x\n# Start date: 20260101\n# End date: 20260922\n"
    with tempfile.TemporaryDirectory() as td:
        c = Path(td, "c.csv"); r = Path(td, "r.csv")
        c.write_text(head + "Country," + hdr + "\n"
                     "United States,1000,900,700,0.6,0.7,120.0,1,5,0,0\n"
                     "Singapore,800,800,10,0.2,0.01,2.0,1,0,0,0\n")
        r.write_text(head + "Region," + hdr + "\n"
                     "(not set),900,1,1,0.2,0.1,4,1,0,0,0\n"
                     "Virginia,300,1,40,0.18,0.1,13.5,1,0,0,0\n"
                     "Iowa,200,1,250,0.66,1.2,140,1,0,0,0\n"
                     "Wisconsin,100,1,260,0.7,2.6,370,1,0,0,0\n"
                     "Maine,30,1,5,0.5,0.2,20,1,0,0,0\n"
                     "Tbilisi,5,1,1,0.5,0.2,20,1,0,0,0\n"
                     "# trailing comment\n")
        a = build(c, r, today="2026-09-22T00:00:00+00:00")
        st = {x["code"]: x for x in a["states"]["rows"]}
        t(a["readers"]["us"] == 1000, "US readers read from the United States row")
        t(a["readers"]["left_out"]["users"] == 800, "Singapore is reported as left out, not added in")
        t(set(st) == {"VA", "IA", "WI", "ME"}, "only US states become rows; (not set) and foreign regions do not")
        t(st["VA"].get("flag") == "server", "a state under the seconds rule with enough readers is flagged")
        t("flag" not in st["IA"], "a normal state is not flagged")
        t("flag" not in st["ME"], "a state under the minimum reader count is never flagged on thin data")
        t(st["WI"].get("flag") == "home", "the home state carries its own-visits note")
        t([x["code"] for x in a["states"]["rows"]][:2] == ["WI", "IA"], "rows are ordered by engaged visits")
        t(st["WI"]["rank"] is None and st["IA"]["rank"] == 1, "the home state is shown but not ranked")
        t(st["VA"]["users"] == 300, "a flagged state keeps its reported number -- nothing is subtracted")
        t(len(a["states"]["missing"]) == 51 - 4, "states absent from the export are listed, not zero-filled")
    print("selftest " + ("passed" if ok else "FAILED"))
    return 0 if ok else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    args = {}
    it = iter(argv)
    for a in it:
        if a.startswith("--"):
            args[a[2:]] = next(it)
    if "country" not in args or "region" not in args:
        print(__doc__)
        return 2
    out = build(args["country"], args["region"], args.get("google"), args.get("bing"), args.get("ai"))
    OUT.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    r, s = out["readers"], out["states"]
    print("US readers %s (%s to %s); %d states with readers; %d flagged as server-heavy"
          % (r["us"], r["start"], r["end"], s["withReaders"],
             sum(1 for x in s["rows"] if x.get("flag") == "server")))
    print("wrote " + str(OUT.relative_to(ROOT)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
