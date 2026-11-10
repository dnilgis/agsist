#!/usr/bin/env python3
"""fetch_slaughter_mars.py -- data/slaughter.json: USDA's estimated daily
federally inspected cattle and hog slaughter, with the week-ago and year-ago
figures USDA prints beside it.

Source: USDA AMS report 3208, "Daily Livestock and Poultry Slaughter"
(estimated, FIS), read through USDA My Market News (the MARS API), section
"Report Livestock Commodity", class "All". Approved by Nov 2 2026. Data
only: no page reads it yet; daily_line is a short plain line the Daily can use
later (not wired in).

WHICH DAY
  The newest report's "Current" rows, the latest slaughter day that is not after
  the report date (Friday's report also carries a Saturday estimate posted ahead
  of the day; that one is left out until a later report carries it as a past
  day). "previous" is the newest earlier day in the same report, as USDA revised
  it.

WITHHELD
  A count that is missing, zero or not a number. A week-ago or year-ago figure
  that is missing is left out of the line, not guessed. A report older than
  STALE_DAYS keeps its numbers, is marked stale and gets no daily_line. A run
  that cannot read the report keeps the previous file.

Usage:
  python3 scripts/fetch_slaughter_mars.py              # fetch (needs MARS_API_KEY), write
  python3 scripts/fetch_slaughter_mars.py --fixtures DIR [--out PATH] [--today YYYY-MM-DD]
  python3 scripts/fetch_slaughter_mars.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_state_grain_mars as G  # noqa: E402  one MARS reader (auth, retries, sections)

ROOT = G.ROOT
OUT = os.path.join("data", "slaughter.json")
SLUG = "3208"
TITLE = "Daily Livestock and Poultry Slaughter"
STALE_DAYS = 5
SPECIES = ("Cattle", "Hogs")
DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def head(v):
    x = G.num(v)
    return int(round(x)) if x is not None and x > 0 else None


def parse(secs, today):
    """MARS sections -> (doc fields, None) or (None, reason)."""
    rows = [r for r in secs.get("Report Livestock Commodity") or []
            if str(r.get("class") or "").strip().lower() == "all"]
    days = sorted({G.iso(r.get("report_date")) for r in rows if G.iso(r.get("report_date"))})
    if not days:
        return None, "no livestock rows in the window"
    rday = days[-1]
    rows = [r for r in rows if G.iso(r.get("report_date")) == rday]
    title = next((r.get("report_title") for r in rows if r.get("report_title")), TITLE)
    out = {"report": title, "report_date": rday, "source": G.source_line(title, rday),
           "stale": (today - datetime.date.fromisoformat(rday)).days > STALE_DAYS}
    for sp in SPECIES:
        mine = [r for r in rows if str(r.get("commodity") or "").strip() == sp and G.iso(r.get("slaughter_date"))]
        cur = [r for r in mine if str(r.get("period") or "").lower() == "current"
               and G.iso(r.get("slaughter_date")) <= rday and head(r.get("slaughter")) is not None]
        if not cur:
            continue
        r = max(cur, key=lambda x: G.iso(x.get("slaughter_date")))
        sd = G.iso(r.get("slaughter_date"))
        rec = {"date": sd, "head": head(r.get("slaughter"))}
        for k, src in (("week_ago", "week_ago"), ("year_ago", "year_ago"), ("week_to_date", "week_to_date"),
                       ("prev_week_to_date", "prev_week_to_date"), ("year_ago_week_to_date", "last_year_week_to_date")):
            v = head(r.get(src))
            if v is not None:
                rec[k] = v
        prev = [x for x in mine if str(x.get("period") or "").lower() == "previous"
                and G.iso(x.get("slaughter_date")) < sd and head(x.get("slaughter")) is not None]
        if prev:
            p = max(prev, key=lambda x: G.iso(x.get("slaughter_date")))
            rec["previous"] = {"date": G.iso(p.get("slaughter_date")), "head": head(p.get("slaughter")),
                               "revised": str(p.get("revision") or "").lower() == "yes"}
        out[sp.lower()] = rec
    if "cattle" not in out and "hogs" not in out:
        return None, "no cattle or hog count"
    out["daily_line"] = daily_line(out)
    return out, None


def fmt(n):
    return "{:,}".format(n)


def daily_line(d):
    if d.get("stale"):
        return None
    parts, days = [], set()
    for sp in ("cattle", "hogs"):
        r = d.get(sp)
        if not r:
            continue
        days.add(r["date"])
        ctx = []
        if "week_ago" in r:
            ctx.append("%s a week ago" % fmt(r["week_ago"]))
        if "year_ago" in r:
            ctx.append("%s a year ago" % fmt(r["year_ago"]))
        parts.append("%s %s head%s" % (sp, fmt(r["head"]), " (%s)" % ", ".join(ctx) if ctx else ""))
    if not parts or len(days) != 1:
        return None
    day = datetime.date.fromisoformat(days.pop())
    return "Estimated federally inspected slaughter, %s %s %d: %s. %s." % (
        DOW[day.weekday()], G.MON_ABBR[day.month - 1], day.day, "; ".join(parts), d["source"])


def build(get, prev, today, log=print):
    try:
        ent, why = parse(G.sections(get(SLUG)), today)
    except Exception as e:  # never stop the workflow
        ent, why = None, str(e)[:120]
    if ent and prev and prev.get("report_date", "") > ent["report_date"]:
        ent, why = None, "older than the kept file"
    if not ent:
        log("slaughter: %s; the file is left as it is" % why)
        return None
    doc = {"schema": "agsist-slaughter/1",
           "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "note": "USDA's estimated federally inspected slaughter, head. week_ago and year_ago are USDA's "
                   "figures for the same day; week_to_date runs Monday through this day."}
    doc.update(ent)
    log("slaughter: %s, cattle %s, hogs %s" % (ent["report_date"], (ent.get("cattle") or {}).get("head"),
                                                (ent.get("hogs") or {}).get("head")))
    return doc


def selftest():
    fails = []

    def ck(name, cond, detail=""):
        print("  %s %s%s" % ("ok  " if cond else "FAIL", name, "" if cond else "  " + str(detail)[:300]))
        if not cond:
            fails.append(name)

    def row(rd, sp, per, sd, n, wa=None, ya=None, rev="No"):
        return {"report_date": rd, "report_title": TITLE, "commodity": sp, "class": "All", "period": per,
                "slaughter_date": sd, "slaughter": n, "week_ago": wa, "year_ago": ya, "revision": rev}
    fri = [row("10/30/2026", "Cattle", "Current", "2026-10-30", "96000", "96000", "98228"),
           row("10/30/2026", "Cattle", "Current", "2026-10-31", "13000", "20000", "2167"),
           row("10/30/2026", "Cattle", "Previous", "2026-10-29", "109000", rev="Yes"),
           row("10/30/2026", "Hogs", "Current", "2026-10-30", "486000", "457000", "454789"),
           row("10/30/2026", "Hogs", "Current", "2026-10-31", "190000", "202000", "188869")]
    d, why = parse({"Report Livestock Commodity": fri}, datetime.date(2026, 10, 30))
    ck("Friday report: the Saturday estimate posted ahead is not the latest day", d["cattle"]["date"] == "2026-10-30"
       and d["cattle"]["head"] == 96000, d or why)
    ck("previous day as revised", d["cattle"]["previous"] == {"date": "2026-10-29", "head": 109000, "revised": True})
    ck("daily line", d["daily_line"] == "Estimated federally inspected slaughter, Fri Oct 30: cattle 96,000 head "
       "(96,000 a week ago, 98,228 a year ago); hogs 486,000 head (457,000 a week ago, 454,789 a year ago). "
       "USDA AMS, Daily Livestock and Poultry Slaughter, Oct 30, 2026.", d["daily_line"])
    z = [row("10/30/2026", "Cattle", "Current", "2026-10-30", "0", "96000"),
         row("10/30/2026", "Hogs", "Current", "2026-10-30", "486000", None, "454789")]
    d2, _ = parse({"Report Livestock Commodity": z}, datetime.date(2026, 10, 30))
    ck("zero count withheld, missing week-ago left out", "cattle" not in d2 and "week_ago" not in d2["hogs"]
       and "a week ago" not in d2["daily_line"], d2)
    d3, _ = parse({"Report Livestock Commodity": fri}, datetime.date(2026, 11, 12))
    ck("stale report: numbers kept, no daily line", d3["stale"] and d3["daily_line"] is None)
    ck("nothing readable: reason, no file", parse({}, datetime.date(2026, 10, 30))[0] is None)

    def boom(slug):
        raise RuntimeError("HTTP 500")
    ck("failed fetch keeps the file", build(boom, {"report_date": "2026-10-30"}, datetime.date(2026, 11, 2), log=lambda *a: None) is None)

    fx = os.path.join(ROOT, "test", "fixtures", "mars-slaughter")
    if os.path.isdir(fx):
        doc = build(G.fixture_getter(fx), None, datetime.date(2026, 11, 2), log=lambda *a: None)
        ck("real case Nov 2: cattle 104,000, hogs 492,000", doc and doc["cattle"]["head"] == 104000
           and doc["hogs"]["head"] == 492000 and doc["cattle"]["year_ago"] == 110771, doc)
        ck("real case: Monday's previous day is Saturday Oct 31 as USDA lists it",
           doc["cattle"]["previous"]["date"] == "2026-10-31", doc["cattle"].get("previous"))
        ck("real case daily line", doc["daily_line"] == "Estimated federally inspected slaughter, Mon Nov 2: cattle "
           "104,000 head (106,000 a week ago, 110,771 a year ago); hogs 492,000 head (484,000 a week ago, 496,398 a "
           "year ago). USDA AMS, Daily Livestock and Poultry Slaughter, Nov 2, 2026.", doc["daily_line"])
        s = json.dumps(doc)
        ck("real case: no em dash, no link", "—" not in s and "http" not in s)
    else:
        ck("real-case fixture present", False, fx)
    print("fetch_slaughter_mars selftest: %s" % ("all ok" if not fails else "%d FAILED" % len(fails)))
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    out = argv[argv.index("--out") + 1] if "--out" in argv else OUT
    today = datetime.date.fromisoformat(argv[argv.index("--today") + 1]) if "--today" in argv else datetime.date.today()
    if "--fixtures" in argv:
        get = G.fixture_getter(argv[argv.index("--fixtures") + 1])
    else:
        if not G.auth_header():
            print("slaughter: no MARS_API_KEY; nothing fetched, the file is left as it is")
            return 0
        get = lambda slug: G.mars_get(slug, today=today)  # noqa: E731
    doc = build(get, G.load(out), today)
    if doc:
        G.write(doc, out)
        print("slaughter: wrote %s" % out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
