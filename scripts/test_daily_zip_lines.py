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

    # ── no em dash in the new words ─────────────────────────────────────────
    ok("\u2014" not in LAND_TEXT + RANK and "\u2014" not in b5["text"], "no em dash")
    print("test_daily_zip_lines: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
