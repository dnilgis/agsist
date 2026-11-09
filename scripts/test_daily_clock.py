#!/usr/bin/env python3
"""
test_daily_clock.py -- the Daily's one clock (panel Nov 9 2026, skeptic 3(a) 1 to 5),
each rule on the real published day it broke (data/daily-archive/<date>.json,
daily/<date>.html) or a frozen copy of the data file that day read
(test/fixtures/daily-clock, test/fixtures/daily-audit). Run by
test/daily-clock.test.mjs; no network, nothing is sent.

  1 Nov 9   each crop's own clock on the Today line; Jan beans after Nov first notice
  2 Nov 5   the chart holds settles on their own dates, never the 5:46 a.m. trade
    Nov 9   month to date from settles of one contract; the note under the strip
            names the settle's own day, never "Exchange settles, Mon Nov 9"
  3 Nov 1   live cattle named by the month the price belongs to (Dec '26), the
            same contract and price for the same Friday on Oct 31 and Nov 1
  4 Oct 28  "fast harvest" with corn 60% vs a 66% average is cut
    Oct 30  a run-of-settles subject prints the locked settle, $12.19¾
  5         issue numbers go up by one; "1 trading day left"; the clock stops at
            0; "Beans have settled"

    python3 scripts/test_daily_clock.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import copy
import json
import os
import pathlib
import sys
import tempfile
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIX = os.path.join(REPO, "test", "fixtures", "daily-clock")
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_v2 as V        # noqa: E402
import daily_adds as A      # noqa: E402
import daily_claims as C    # noqa: E402
import generate_daily as G  # noqa: E402

FAILS = []
NO_CHECK = os.path.join(os.environ["RUNNER_TEMP"], "none.json")


def ok(c, m):
    if not c:
        FAILS.append(m)
        print("FAIL", m)


def load(d):
    with open(os.path.join(REPO, "data", "daily-archive", d + ".json"), encoding="utf-8") as f:
        return json.load(f)


def page(d):
    with open(os.path.join(REPO, "daily", d + ".html"), encoding="utf-8") as f:
        return f.read()


def build(daily, d):
    return V.build(daily, "https://agsist.com/daily/%s.html" % d, today=date.fromisoformat(d))


def strip(daily):
    return G.build_quote_strip(daily["locked_prices"], daily["locked_changes"], daily.get("board"))


def main():
    # ── 1. Nov 9: each crop on its own clock; Jan beans after first notice ──
    n9 = load("2026-11-09")
    ok(n9["locked_changes"]["beans-nov"]["kind"] == "settle" and n9["locked_changes"]["corn-dec"]["kind"] == "last",
       "fixture: Nov 9 locked Friday's Nov bean settle beside Monday's overnight corn")
    line = V.market_items(n9)[0][-1]["text"]
    ok(line == "Overnight: corn $4.43 (+1½¢), Jan beans $11.94¾ (+1¢) at 5:45 a.m. CT vs Friday's settle.",
       "Nov 9 Today line quotes Jan beans overnight: %r" % line)
    ok("$11.89" not in line and "+8¢" not in line, "Friday's Nov bean settle move is not called overnight: %r" % line)
    # the same day with no nearby on file: beans keep Friday's settle, and say so
    n9b = copy.deepcopy(n9)
    del n9b["locked_prices"]["beans"]
    line_b = V.market_items(n9b)[0][-1]["text"]
    ok(line_b == "Overnight: corn $4.43 (+1½¢) at 5:45 a.m. CT vs Friday's settle. Friday's settle: beans $11.89 (+8¢).",
       "a settle row is labeled as the settle, not overnight: %r" % line_b)
    b9 = build(n9, "2026-11-09")
    board = b9["text"][b9["text"].index("THE BOARD"):]
    ok("Beans, Jan '27 $11.94¾ +1¢\n" in board, "the board names Jan beans: %r" % board[:300])
    ok("Beans, Nov $11.89 +8¢ (Fri settle)" in board, "the Nov bean row carries its own settle day: %r" % board[:300])
    ok("Fri settle" in b9["html"], "the HTML board carries the row's own clock too")
    ok(board.startswith("THE BOARD (Last trade 5:45 a.m. CT, change from Friday's settle)"),
       "a 4-4 tie of clocks goes to corn's, every run: %r" % board[:80])
    s9 = strip(n9)
    ok([(q["key"], q["contract"], q.get("kind")) for q in s9["quotes"]]
       == [("corn-dec", "Dec '26", "last"), ("beans", "Jan '27", "last"), ("wheat", "Dec '26", "last")],
       "Nov 9 strip shows Jan beans, a last trade, and names wheat's month as the board does: %s" % s9["quotes"])
    ok("Wheat, Dec '26" in board, "the email board names the same wheat month as the strip")
    # the Oct 30 issue (first notice day, nearby not yet named in the lock) keeps one Nov '26 row
    s30 = strip(load("2026-10-30"))
    ok([q["key"] for q in s30["quotes"]] == ["corn-dec", "beans-nov", "wheat"], "no month named: the strip keeps Nov beans")

    # ── 2. one clock: chart, month to date, the note under the strip ──
    n5 = load("2026-11-05")
    ser, days = G.build_chart_series(n5["locked_prices"], False, today_locked_changes=n5["locked_changes"],
                                     archive_dir=os.path.join(REPO, "data", "daily-archive"), today_iso="2026-11-05")
    ok(days and days[-1] == "2026-11-04" and ser["corn"][-1] == 4.4425,
       "Nov 5 chart ends at Nov 4's settle 4.4425, not the 5:46 a.m. trade: %s %s" % (days[-2:], ser.get("corn", [])[-2:]))
    ok(4.4725 not in ser["corn"] and 4.405 not in ser["corn"], "no overnight trade in the chart: %s" % ser["corn"])
    ok(n5["chart_dates"][-1] == "2026-11-05" and n5["chart_series"]["corn"][-1] == 4.4725,
       "fixture: the published Nov 5 chart put the trade on Nov 5")
    ser9, days9, own9 = G.build_chart_series(n9["locked_prices"], False, today_locked_changes=n9["locked_changes"],
                                             archive_dir=os.path.join(REPO, "data", "daily-archive"), today_iso="2026-11-09",
                                             with_dates=True)
    ok(own9["corn"][-1] == own9["soybeans"][-1] == "2026-11-06" and ser9["soybeans"][-1] == 11.9375 and ser9["corn"][-1] == 4.415,
       "Nov 9 chart: Friday's settles, Jan beans: %s %s" % (own9, ser9))
    ok(len(ser9["corn"]) >= 8 and days9 == own9["corn"],
       "a short Jan bean history never cuts corn's Dec history: corn %d points" % len(ser9["corn"]))
    ok(own9["soybeans"][0] >= "2026-11-03" and len(ser9["soybeans"]) == len(own9["soybeans"]),
       "beans plot only Jan settles (the lock named Jan from the Nov 4 issue): %s" % own9["soybeans"])
    for d in ("2026-11-04", "2026-11-05"):
        dd = load(d)
        sd, _dd = G.build_chart_series(dd["locked_prices"], False, today_locked_changes=dd["locked_changes"],
                                       archive_dir=os.path.join(REPO, "data", "daily-archive"), today_iso=d)
        ok(len(sd.get("corn", [])) >= 8, "%s chart keeps corn's history: %d points" % (d, len(sd.get("corn", []))))
    pw = A.windows_text(A.price_windows("2026-11-09", s9["quotes"], n9["locked_changes"],
                                        os.path.join(REPO, "data", "daily-archive")))
    ok(pw == ["Month to date: Corn −6 1/4¢ (−1.40%)"],
       "Nov 9 month to date: Friday's corn settle against Oct 30's, beans withheld (no Jan baseline on file): %s" % pw)
    ok("Corn −4 3/4¢ (−1.06%), Soybeans −33 1/4¢" in page("2026-11-09"), "fixture: the published Nov 9 page mixed the clocks")
    note = G.quote_strip_note(s9)
    ok("Mon Nov 9" not in note and note.startswith("Last trades as of 5:4"), "Nov 9 note: %r" % note)
    ok("Exchange settles, Mon Nov 9" in page("2026-11-09"), "fixture: the published Nov 9 page named a settle that had not happened")
    n9c = copy.deepcopy(n9)
    n9c["locked_changes"]["beans"].pop("contract")
    note_c = G.quote_strip_note(strip(n9c))
    ok(note_c.startswith("Exchange settles, Fri Nov 6, except the last trade for Corn and Wheat as of 5:4"),
       "a mixed strip names the settle's own day: %r" % note_c)

    # ── 3. Nov 1: a rolled contract named by its own month ──
    G.PRICES_PATH = pathlib.Path(os.path.join(REPO, "test", "fixtures", "daily-audit", "prices-2026-10-31-livestock.json"))
    locked, _s = G.load_prices()
    cat = locked["locked_changes"]["cattle"]
    ok(locked["locked_prices"]["cattle"] == 220.95 and cat.get("contract") == "Dec '26",
       "Friday Oct 30 live cattle is Dec '26 $220.95: %s" % cat)
    ok("Live Cattle Dec '26: $220.95" in locked["price_block"], "the writer's price table names Dec '26")
    labels = []
    for d in ("2026-10-31", "2026-11-01"):
        dd = load(d)
        dd["locked_prices"]["cattle"] = locked["locked_prices"]["cattle"]
        dd["locked_changes"]["cattle"] = cat
        t = build(dd, d)["text"]
        labels.append(next(x.strip() for x in t.splitlines() if x.strip().startswith("Live cattle")))
    ok(labels == ["Live cattle, Dec '26 $220.95 −2.4%"] * 2, "both issues of the same Friday: one contract, its own month: %s" % labels)
    ok(load("2026-10-31")["locked_prices"]["cattle"] == 224.0 and load("2026-11-01")["locked_prices"]["cattle"] == 220.95,
       "fixture: the published issues locked two contracts for one Friday")
    c1 = C.context(json.load(open(G.PRICES_PATH)), date(2026, 11, 1))
    ok(any(r == "month-mismatch" for r, _, _ in C.lint({"lead": "October live cattle fell 2.4% to $220.95."}, c1)),
       "the Nov 1 line as published is caught")

    # ── 4. claim checks ──
    cp = json.load(open(os.path.join(FIX, "crop-progress-2026-10-28.json")))
    o28 = load("2026-10-28")
    hits = [(loc, s) for r, loc, s in C.lint(o28, C.context({}, date(2026, 10, 28), o28.get("quote_strip"), cp)) if r == "harvest-pace"]
    ok(any("fast harvest has been the weight on grain" in s for _, s in hits),
       "Oct 28: the published 'fast harvest' line is caught: %s" % hits)
    cut, log = C.strip(copy.deepcopy(o28), C.context({}, date(2026, 10, 28), o28.get("quote_strip"), cp))
    ok("fast harvest" not in json.dumps(cut.get("lead")) and any("harvest-pace" in x for x in log),
       "strip cuts it from the lead: %s" % [x for x in log if "harvest" in x])
    V.HARVEST_PRICES = os.path.join(FIX, "harvest-prices-2026-10-30.json")
    o30 = load("2026-10-30")
    ok(V.streak("soybeans", "2026-10-30")[2] == 12.205, "fixture: the harvest file's Oct 29 close was 12.205")
    b30 = build(o30, "2026-10-30")
    ok(b30["subject"] == "Beans' 4th lower close in a row: $12.19¾" and b30["subject_field"] == "harvest-prices",
       "Oct 30 subject prints the locked settle: %r" % b30["subject"])
    bad, _n = V.check(o30, b30, NO_CHECK)
    ok(not bad, "the corrected subject passes: %s" % bad)
    bad, _n = V.check(o30, dict(b30, subject="Beans' 4th lower close in a row: $12.20½"), NO_CHECK)
    ok(bad and "not a locked settle" in bad[0]["why"], "the subject as sent blocks: %s" % bad)

    # ── 5. small ones ──
    idx = os.path.join(FIX, "index-dates-2026-11-09.json")
    for d, want, sent in (("2026-10-16", 217, 218), ("2026-10-28", 229, 230), ("2026-11-03", 235, 236), ("2026-11-09", 241, 241)):
        got = G.load_issue_number(d, idx) + 1
        ok(got == want, "issue number on %s: %d (want %d; the index count gave %d)" % (d, got, want, sent))
    ok(load("2026-10-28")["issue_number"] == 230 and load("2026-10-29")["issue_number"] == 230, "fixture: #230 twice")
    seq = [G.load_issue_number(d, idx) + 1 for d in ("2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30")]
    ok(seq == [228, 229, 230, 231], "numbers go up by one: %s" % seq)
    t30 = V.clock_item(o30, date(2026, 10, 30))["text"]
    ok(t30.endswith(". 1 trading day left."), "Oct 30: %r" % t30)
    o31 = load("2026-10-31")
    t31 = V.clock_item(o31, date(2026, 10, 31))["text"]
    ok(t31.endswith(". Last trading day done.") and "0 trading days" not in t31, "Oct 31: %r" % t31)
    neg = copy.deepcopy(o31)
    for c in neg["harvest_clock"]["crops"]:
        c["days_left"] = -1
    tn = V.clock_item(neg, date(2026, 10, 31))["text"]
    ok(tn.endswith(". Last trading day done."), "the clock stops at 0: %r" % tn)
    V.HARVEST_PRICES = os.path.join(FIX, "harvest-prices-2026-10-30.json")
    o29 = load("2026-10-29")
    t29 = V.market_items(o29)[0][0]["text"]
    ok(t29.startswith("Beans have settled lower 3 days running"), "Oct 29: %r" % t29)
    ok(not any("—" in x for x in (line, line_b, note, note_c, t29, t30, t31, b30["subject"])), "no em dash")

    print("test_daily_clock: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
