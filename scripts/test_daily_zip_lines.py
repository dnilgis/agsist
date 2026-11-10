#!/usr/bin/env python3
"""
test_daily_zip_lines.py -- the two lines a ZIP reader got word for word every day (Nov 10 2026 preview):

  land sales   "Farm sales near you: 3 of 10 acres or more recorded within 25 miles in September. The
               largest, 34.9 acres in Lake County, IL, at $10,258 an acre." (ZIP 53401, Racine, WI) in every
               issue Nov 5 to 10, and since Oct 18: data/land-sales/latest.json's "published" rolls with
               every read (Florida Nov 5, 8, 9), so the September month never left its 10-day window.
  record words "That is the 3rd wettest by this date in 82 years on record there (1942 on)." on the same
               reader's rain line (Union Grove station, Racine County) in every issue Nov 5 to 10.

The no-ZIP path met the one memory (scripts/daily_fresh.py) in #458; these two did not. Now both go through it
by the issue's own facts, per state (land) and per county (rank), never per reader: the line prints when its
fact entered or moved since the issue that last printed it, and once per issue. Each case has its real repeat
(withheld) and a real move (printed). Values are the ones the data files held at send time; no live data is
read, nothing is sent.

    python3 scripts/test_daily_zip_lines.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_fresh as F         # noqa: E402
import daily_land_line as LL    # noqa: E402
import daily_v2 as V            # noqa: E402
import only_here as OH          # noqa: E402

FAILS = []


def ok(c, m):
    print(("ok   " if c else "FAIL ") + m)
    if not c:
        FAILS.append(m)


def D(s):
    return date.fromisoformat(s)


def arch(d):
    with open(os.path.join(REPO, "data", "daily-archive", d + ".json"), encoding="utf-8") as f:
        return json.load(f)


# latest.json per_state as it stood at the Nov 5 and Nov 9 2026 sends (git history of data/land-sales/latest.json)
NOV5 = {"month": "2026-09", "published": "2026-11-03", "per_state": {"IL": 121, "IN": 193, "NJ": 0, "VT": 16, "WI": 183},
        "fetched": {"IL": "2026-11-03", "IN": "2026-11-03", "NJ": "2026-10-29", "VT": "2026-11-03", "WI": "2026-10-18"}}
NOV9 = {"month": "2026-09", "published": "2026-11-09", "per_state": {"FL": 79, "IL": 121, "IN": 191, "NJ": 0, "VT": 16, "WI": 183},
        "fetched": {"FL": "2026-11-09", "IL": "2026-11-03", "IN": "2026-11-03", "NJ": "2026-10-29", "VT": "2026-11-03", "WI": "2026-10-18"}}
LAND_TEXT = ("Farm sales near you: 3 of 10 acres or more recorded within 25 miles in September. The largest, 34.9 acres "
             "in Lake County, IL, at $10,258 an acre.")
RAIN_HEAD = ("Your rain: 40.13 in. this year through Nov 3 at the Union Grove station (Racine County, 18 mi from you), "
             "128% of normal for the date.")
RANK = " That is the 3rd wettest by this date in 82 years on record there (1942 on)."
RANK_FACT = {"kind": "rain_rank", "key": "WI:55101", "value": "wettest:3"}


def land_line(L, states=("IL", "WI")):
    return {"text": LAND_TEXT, "kind": "land_sales", "url": "/land-sales/2026-09", "link": "x", "n": 3,
            "facts": [LL.state_fact(L, s) for s in states]}


def rain_line(rank=RANK, fact=RANK_FACT):
    return {"text": RAIN_HEAD + rank, "kind": "rain_vs_normal", "url": "/rain/wisconsin/racine-county", "link": "x", "n": 1,
            "record": {"text": rank, "fact": fact}}


def build(day, lines, zf, memory, rain=True, county=None):
    """daily_v2.build for a ZIP reader (rain=True) or a no-ZIP reader, with only_here and the issue's ZIP facts given."""
    keep = (V.only_here, V.zip_facts)
    V.only_here = lambda daily, r=None, loc=None: [dict(x) for x in lines] if r else []
    V.zip_facts = lambda iso: list(zf)
    try:
        return V.build(arch(day), "https://agsist.com/daily/%s.html" % day, today=D(day), memory=memory,
                       fact={"text": "x", "source": "y", "url": None}, rain={"zip": "53401", "town": "Racine, WI"} if rain else None,
                       county=county)
    finally:
        V.only_here, V.zip_facts = keep


# the no-ZIP line as both issues printed it (data/daily-sent/2026-11-10.json printed list; Nov 9 the same words)
REC_TEXT = ("Rain records: 12 counties are at the wettest year to date in their station's record and 16 at the driest. "
            "The longest of those records, Jefferson County, AR, goes back to 1891 (driest).")
REC_FIRST = "Jefferson County, AR, 1891, driest"


def rec_line(wet=12, dry=16, first=REC_FIRST, text=REC_TEXT):
    return {"text": text, "kind": "rain_records", "url": "/rain#records", "link": "Every record county", "n": wet + dry,
            "fact": {"kind": "rain_records", "key": "us", "value": [wet, dry, first], "text": text}}


def build_nozip(day, lines, memory, issue=None):
    """daily_v2.build for a no-ZIP reader; issue = the archived issue it renders (default: the day's own)."""
    keep = (V.only_here, V.zip_facts)
    V.only_here = lambda daily, r=None, loc=None: [dict(x) for x in lines]
    V.zip_facts = lambda iso: []
    try:
        return V.build(arch(issue or day), "https://agsist.com/daily/%s.html" % day, today=D(day), memory=memory,
                       fact={"text": "x", "source": "y", "url": None})
    finally:
        V.only_here, V.zip_facts = keep


LABEL = V._label("Only here", cls="lab", color=V.GREEN, pad=14)


def recs(b5):
    """The Nov 9 values give no line on the 10th; a changed count or oldest record prints."""
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "rain"))
        rows = [{"one_gauge": False, "as_of": "2026-11-08", "side": "wettest", "first": 1950 + i, "county": "W%d" % i, "state": "IA"}
                for i in range(12)]
        rows += [{"one_gauge": False, "as_of": "2026-11-08", "side": "driest", "first": 1891 if i == 0 else 1950 + i,
                  "county": "Jefferson County" if i == 0 else "D%d" % i, "state": "AR"} for i in range(16)]
        rows.append({"one_gauge": True, "as_of": "2026-11-08", "side": "driest", "first": 1880, "county": "One", "state": "KS"})
        import rain_records as RR
        keep = RR.rows
        RR.rows = lambda d, within=1: [dict(r) for r in rows]
        try:
            rl = OH.records_line("2026-11-10", t)
        finally:
            RR.rows = keep
    ok(rl and rl["text"] == REC_TEXT, "the records line words, one-gauge left off: %r" % (rl and rl["text"]))
    ok(rl and rl["fact"] == rec_line()["fact"], "its fact: both counts and the oldest record: %r" % (rl and rl["fact"]))
    nov9 = [dict(rec_line()["fact"], date="2026-11-09")]
    b = build_nozip("2026-11-10", [rec_line()], nov9)
    ok("Rain records" not in b["text"] and "Rain records" not in b["html"], "Nov 10 after the same Nov 9 line: no rain records line")
    ok("ONLY HERE" not in b["text"] and LABEL not in b["html"] and b["slots"]["only_here"] == 0,
       "nothing else left: the Only here section is skipped in both the text and the html")
    ok(not any(f["kind"] == "rain_records" for f in b["printed"]), "a withheld line is not saved as printed")
    # the list saved Nov 10 2026 holds the two counts only: the same counts still withhold the line
    b = build_nozip("2026-11-11", [rec_line()], [{"kind": "rain_records", "key": "us", "value": [12, 16], "text": REC_TEXT[:90],
                                                   "date": "2026-11-10"}], issue="2026-11-10")
    ok("Rain records" not in b["text"], "Nov 11 after the Nov 10 list (counts only): withheld")
    b0 = build_nozip("2026-11-10", [rec_line()], [])
    ok(REC_TEXT in b0["text"] and LABEL in b0["html"] and "ONLY HERE" in b0["text"], "nothing printed before: the line and section print")
    ok(any(f["kind"] == "rain_records" and f["value"] == [12, 16, REC_FIRST] for f in b0["printed"]), "a printed line is saved")
    t13 = REC_TEXT.replace("12 counties", "13 counties")
    b = build_nozip("2026-11-10", [rec_line(13, 16, text=t13)], nov9)
    ok(t13 in b["text"] and t13 in b["html"].replace("&#x27;", "'").replace("&#39;", "'"), "13 wettest after 12: the line prints in both")
    b = build_nozip("2026-11-10", [rec_line(first="Pulaski County, AR, 1887, driest")], nov9)
    ok("Rain records" in b["text"], "a new oldest record with the same counts: the line prints")


def zip_rain():
    """Same value for the county as the last issue: dropped; a different value prints. Keyed by county, never reader."""
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "rain"))
        p = os.path.join(t, "data", "rain", "wi.json")
        cty = {"name": "Racine County", "total": 40.13, "pct": 128, "as_of": "2026-11-03",
               "station": {"ll": [-88.03, 42.69], "raw": "UNION GROVE", "name": "Union Grove"}}
        json.dump({"state": "WI", "fetched": "f", "counties": {"55101": cty}}, open(p, "w"))
        OH._stations.cache_clear()
        rl = OH.rain_line((42.73, -87.80), "2026-11-05", t)
        fs = OH.rain_facts("2026-11-05", t)
        none = OH.rain_facts("2026-11-02", t)
        json.dump({"state": "WI", "fetched": "g", "counties": {"55101": dict(cty, total=40.51, pct=129, as_of="2026-11-04")}}, open(p, "w"))
        OH._stations.cache_clear()
        rl2 = OH.rain_line((42.73, -87.80), "2026-11-05", t)
        OH._stations.cache_clear()
    fact = {"kind": "rain_line", "key": "WI:55101", "value": "2026-11-03"}
    ok(rl and rl["fact"] == fact, "the rain line's fact: the station's county and its value: %r" % (rl and rl.get("fact")))
    ok(fs == [fact] and none == [], "the issue's rain line facts, a station reporting after the issue left out: %r %r" % (fs, none))
    mem = [dict(fact, date="2026-11-04")]
    b = build("2026-11-05", [rl], [], memory=mem)
    ok("Your rain" not in b["text"] and "Your rain" not in b["html"], "the same Racine County value as the last issue: the rain line is left out")
    ok("ONLY HERE" not in b["text"] and LABEL not in b["html"], "nothing else left: no Only here section")
    b = build("2026-11-05", [rl2], [], memory=mem)
    ok("Your rain: 40.51 in." in b["text"] and "Your rain: 40.51 in." in b["html"], "a new report (Nov 4, 40.51 in.): the line prints")
    b = build("2026-11-05", [rl], [], memory=[dict(fact, key="WI:55059", date="2026-11-04")])
    ok("Your rain: 40.13 in." in b["text"], "the same value for another county is no repeat")
    # the no-ZIP build carries every station's rain line, news or not; the sent copy keeps the usual day plus the
    # stations on another day, so the record holds every station alike and says nothing about who got a line
    others = [dict(fact, key="WI:55059", value="2026-11-04"), dict(fact, key="WI:55079", value="2026-11-04")]
    nz = build("2026-11-05", [], [fact, RANK_FACT] + others, memory=[], rain=False)
    ok(sum(f["kind"] == "rain_line" for f in nz["printed"]) == 3, "the no-ZIP build's printed list carries every station's rain line")
    same = build("2026-11-05", [], [fact] + others, memory=[dict(f, date="2026-11-04") for f in [fact] + others], rain=False)
    ok(sum(f["kind"] == "rain_line" for f in same["printed"]) == 3, "kept even when no line is news, so each issue's set is whole")
    import send_daily as SD
    with tempfile.TemporaryDirectory() as t:
        sd, ad = os.path.join(t, "sent"), os.path.join(t, "arch")
        os.makedirs(ad)
        SD.save_sent_copy("2026-11-05", {"headline": "x"}, "s", "v2", sd, printed=nz["printed"])
        rec = json.load(open(os.path.join(sd, "2026-11-05.json")))
        mem2 = F.memory(D("2026-11-06"), sd, ad)
    ok(rec.get("rain_lines") == {"as_of": "2026-11-04", "other": {"2026-11-03": ["WI:55101"]}}
       and not any(f.get("kind") == "rain_line" for f in rec["printed"]),
       "the sent copy keeps the usual day and names only the stations off it: %r" % rec.get("rain_lines"))
    ok(any(f.get("kind") == "rain_rank" for f in rec["printed"]), "the other facts stay in the printed list")
    ok(not any(z in json.dumps(rec) for z in ("53401", "Racine, WI")), "no reader's ZIP or town in the sent copy")
    ok({"kind": "rain_line", "key": "WI:55101", "value": "2026-11-03", "text": "", "date": "2026-11-05"} in mem2
       and {"kind": "rain_line", "key": "*", "value": "2026-11-04", "text": "", "date": "2026-11-05"} in mem2,
       "the record reads back as memory")
    b = build("2026-11-06", [rl], [], memory=mem2)
    ok("Your rain" not in b["text"], "Nov 6, the station still at Nov 3: no rain line")
    k = dict(rl, fact=dict(fact, key="WI:55079", value="2026-11-04"))
    b = build("2026-11-06", [k], [], memory=mem2)
    ok("Your rain" not in b["text"], "a station on the issue's usual day, not named, still at that day: no rain line")
    b = build("2026-11-06", [dict(k, fact=dict(k["fact"], value="2026-11-05"))], [], memory=mem2)
    ok("Your rain" in b["text"], "the same station with a new report: the line prints")
    b = build("2026-11-06", [dict(rl, fact=dict(fact, value="2026-11-04"))], [], memory=mem2)
    ok("Your rain" in b["text"], "a named station whose day moved onto the usual day: the line prints")
    # size: every station today, as the record would be written (indent 2, as save_sent_copy writes)
    on = max(str(c.get("as_of") or "") for _, _, _, c in OH._stations(REPO))
    full = OH.rain_facts(on)
    if full:
        n = len(json.dumps({"rain_lines": SD.rain_lines_record(full)}, indent=2))
        print("info rain_lines for %d stations: %d bytes" % (len(full), n))
        ok(n < 20000 or len({f["value"] for f in full}) > 30, "the record stays small while most stations share a day: %d bytes" % n)


def mem_of(*days_printed):
    return [dict(f, date=d) for d, pr in days_printed for f in pr]


def main():
    # ── the facts themselves ────────────────────────────────────────────────
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "land-sales"))
        p = os.path.join(t, "data", "land-sales", "latest.json")
        json.dump(NOV9, open(p, "w"))
        fs = LL.issue_facts("2026-11-09", t)
        ok([(f["key"], f["value"]) for f in fs] == [("2026-09:FL", 79), ("2026-09:IL", 121), ("2026-09:IN", 191), ("2026-09:VT", 16),
                                                     ("2026-09:WI", 183)], "Nov 9: one fact per state with sales, NJ (0) none: %r" % fs)
        ok(LL.issue_facts("2026-11-20", t) == [], "outside the 10-day window: no facts")
        ok(all(set(f) == {"kind", "key", "value", "text"} for f in fs), "no reader's place in a land fact")
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(os.path.join(t, "data", "rain", "context"))
        json.dump({"state": "WI", "fetched": "f", "counties": {"55101": {"name": "Racine County", "total": 40.13, "pct": 128,
                   "as_of": "2026-11-03", "station": {"ll": [-88.03, 42.69], "raw": "UNION GROVE", "name": "Union Grove"}}}},
                  open(os.path.join(t, "data", "rain", "wi.json"), "w"))
        json.dump({"state": "WI", "fetched": "f", "counties": {"55101": {"rank": {"n": 82, "first": 1942, "wetter": 2, "drier": 79}}}},
                  open(os.path.join(t, "data", "rain", "context", "wi.json"), "w"))
        OH._stations.cache_clear()
        rl = OH.rain_line((42.73, -87.80), "2026-11-05", t)
        ok(rl and rl["text"].endswith(RANK.strip()) and rl["record"]["text"] == RANK, "the record words ride the rain line: %r" % (rl and rl["text"]))
        ok(rl and rl["record"]["fact"] == RANK_FACT, "keyed by county, valued by side and place: %r" % (rl and rl["record"]))
        ok(OH.record_facts("2026-11-05", t) == [RANK_FACT], "the issue's record facts: the county's, not the reader's")
        ok(OH.record_facts("2026-11-02", t) == [], "a station reporting after the issue gives no fact")
        OH._stations.cache_clear()

    # ── land: Nov 5 printed it, Nov 6 to 10 are the same month and counts: withheld ──
    z5 = [f for f in (LL.state_fact(NOV5, s) for s in sorted(NOV5["per_state"])) if f] + [RANK_FACT]
    b5 = build("2026-11-05", [rain_line(), land_line(NOV5)], z5, memory=[])
    ok(LAND_TEXT in b5["text"] and RANK.strip() in b5["text"], "Nov 5, nothing printed before: both lines print")
    nz5 = build("2026-11-05", [], z5, memory=[], rain=False)
    saved5 = nz5["printed"]
    ok(sum(1 for f in saved5 if f["kind"] == "land_sales") == 4 and RANK_FACT in [{k: f[k] for k in ("kind", "key", "value")} for f in saved5],
       "the no-ZIP build (the sent copy's list) carries the issue's ZIP facts: %r" % [(f["kind"], f.get("key")) for f in saved5])
    with tempfile.TemporaryDirectory() as t:
        sd, ad = os.path.join(t, "sent"), os.path.join(t, "arch")
        os.makedirs(sd)
        os.makedirs(ad)
        json.dump({"date": "2026-11-05", "printed": saved5}, open(os.path.join(sd, "2026-11-05.json"), "w"))
        mem = F.memory(D("2026-11-06"), sd, ad)
    ok(any(m["kind"] == "land_sales" and m["key"] == "2026-09:WI" for m in mem) and any(m["kind"] == "rain_rank" for m in mem),
       "the saved list reads back as memory")
    for day in ("2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"):
        L = NOV9 if day == "2026-11-09" else NOV5
        b = build(day, [rain_line(), land_line(L)], [], memory=mem)
        ok(LAND_TEXT not in b["text"], "%s: the same September month and counts, the land line withheld" % day)
        ok(RANK.strip() not in b["text"] and "Your rain: 40.13 in." in b["text"],
           "%s: the 3rd-wettest words withheld, the rain line stays" % day)
    # Indiana 193 (Nov 5) then 191 (Nov 9, a re-read): no news for an Indiana reader
    b = build("2026-11-09", [land_line(NOV9, ("IN",))], [], memory=mem)
    ok(LAND_TEXT not in b["text"], "Nov 9 Indiana 191 after 193: fewer is not news")
    # Florida entered Nov 6 (79 sales): a reader near Florida sales gets it once
    b = build("2026-11-09", [land_line(NOV9, ("FL",))], [], memory=mem)
    ok(LAND_TEXT in b["text"], "Florida's September, never printed: the line prints")

    # ── real moves print ────────────────────────────────────────────────────
    more = dict(NOV9, per_state=dict(NOV9["per_state"], IL=130))
    b = build("2026-11-09", [land_line(more)], [], memory=mem)
    ok(LAND_TEXT in b["text"], "Illinois files add 9 September sales: the line prints again")
    octo = dict(NOV9, month="2026-10")
    b = build("2026-11-09", [land_line(octo)], [], memory=mem)
    ok(LAND_TEXT in b["text"], "a new month (October): the line prints")
    b = build("2026-11-09", [rain_line(" That is the 2nd wettest by this date in 82 years on record there (1942 on).",
                                       dict(RANK_FACT, value="wettest:2"))], [], memory=mem)
    ok("2nd wettest" in b["text"], "Racine County moves from 3rd to 2nd wettest: the words print")
    old = [dict(m, date="2026-10-18") for m in mem]       # what daily_fresh.memory holds is the last 21 days
    b = build("2026-11-09", [rain_line()], [], memory=[m for m in old if m["date"] >= "2026-10-19"])
    ok(RANK.strip() in b["text"], "told 22 days before, out of the memory's window: the rank is told again")

    # ── never twice in one issue ────────────────────────────────────────────
    b = build("2026-11-05", [rain_line(), land_line(NOV5), land_line(NOV5)], [], memory=[])
    ok(b["text"].count("Farm sales near you") == 1 and b["html"].count("Farm sales near you") == 1, "one land line per issue")
    cw = {"county": "Racine", "st": "WI", "url": "/atlas/wi/racine", "block": {"rows": [
        {"kind": "changed", "label": "Land sales", "text": "3 recorded farm sales of 10 acres or more in Racine dated in September.",
         "date": "records through Sep 30", "src": "Wisconsin Department of Revenue"}]}}
    b = build("2026-11-05", [rain_line(), land_line(NOV5)], [], memory=[], county=cw)
    ok("Farm sales near you" not in b["text"], "a Thursday county block with its land row: the Only here land line steps aside")

    # ── Nov 9 and 10 2026: the no-ZIP rain records line went out word for word ──
    recs(b5)
    # ── a ZIP reader's rain line from a station that has not reported since the last issue ──
    zip_rain()

    # ── no em dash in the new words ─────────────────────────────────────────
    ok("\u2014" not in LAND_TEXT + RANK and "\u2014" not in b5["text"], "no em dash")
    print("test_daily_zip_lines: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
