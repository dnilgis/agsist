#!/usr/bin/env python3
"""
test_daily_memory.py -- Daily phase 2 (panel Nov 9 2026, Sig "all"; brief
notes/plans/daily-phase2.md items 1 to 10). Each rule is tested on the real day
it failed (data/daily-archive, data/daily-sent, or a frozen copy of the data file
that morning in test/fixtures/daily-memory), and each rule also has a case where
the line DOES print because its fact changed: a quiet Daily is fine, a Daily that
hides a real move is not. Run by test/daily-memory.test.mjs; no network, nothing
is sent.

  1 one memory, by fact     Nov 9 funds 8,795 after Nov 7's -72,318 (one release);
                            Nov 1 ratio 2.48 again; a printed list read back
  2 state basis line        Nov 9 send-day basis-states: Ohio and Indiana pass the
                            gates, North Dakota (0.0) does not; quiet next day;
                            prints again on a 5 cent move, an entry or a leave
  3 funds                   Sat Nov 7 told as the streak (7 weeks, 405,665); Mon
                            Nov 9 nothing
  4 overnight               Nov 9 (+1½¢, +1¢) and the Nov 7 and 8 weekend settle
                            lines cut; a 6 cent weekday move prints
  5 ratio and percentile    feeders 74th Nov 7, 8, 9: printed once; a 6 point move
                            and a band cross print; Nov 8 ratio 2.43 (0.05) prints
  6 cash count              Nov 3 thin day (293 boards) and the Nov 1, 2, 8, 9
                            reprints withheld; Nov 4 (1,783) prints
  7 month to date, WASDE    Nov 7 and 8 month row equal to week: cut; Nov 9 keeps
                            it; WASDE in What to watch Nov 7 cut, Nov 9 and 10 kept
  8 raw counts              the Nov 9 web block (counts only) puts nothing on the page
  9 subject                 Nov 9 bare number never leads; a report day leads, with
                            the number to beat only when a range is in hand
 10 no-ZIP Today slot       the state basis line second when it prints, else nothing

    python3 scripts/test_daily_memory.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import copy
import json
import os
import sys
import tempfile
from datetime import date, datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FIX = os.path.join(REPO, "test", "fixtures", "daily-memory")
sys.path.insert(0, HERE)
os.environ.pop("FACT_CHECK_JSON", None)
os.environ["RUNNER_TEMP"] = tempfile.mkdtemp()
import daily_fresh as F     # noqa: E402
import daily_v2 as V        # noqa: E402
import daily_adds as A      # noqa: E402
import daily_edge as E      # noqa: E402
import daily_more as M      # noqa: E402
import only_here as OH      # noqa: E402

FAILS = []


def ok(c, m):
    if not c:
        FAILS.append(m)
        print("FAIL", m)


def arch(d):
    with open(os.path.join(REPO, "data", "daily-archive", d + ".json"), encoding="utf-8") as f:
        return json.load(f)


def sent(d):
    with open(os.path.join(REPO, "data", "daily-sent", d + ".json"), encoding="utf-8") as f:
        return json.load(f)


def fix(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return json.load(f)


def D(s):
    return date.fromisoformat(s)


def build(b, d, memory=None, **kw):
    kw.setdefault("fact", {"text": "x", "source": "y", "url": None})
    return V.build(b, "https://agsist.com/daily/%s.html" % d, today=D(d), memory=memory if memory is not None else [], **kw)


def today_texts(built):
    return [x["text"] for x in built["items"]]


NOV9_WOW_ROWS = None


def nov9_rows():
    global NOV9_WOW_ROWS
    if NOV9_WOW_ROWS is None:
        NOV9_WOW_ROWS = OH.wow_rows(fix("basis-states-2026-11-09.json"),
                                    datetime(2026, 11, 9, 10, 50, tzinfo=timezone.utc))[0]
    return NOV9_WOW_ROWS


def main():
    # ── 1. one memory, keyed by fact ────────────────────────────────────────
    n7, n9 = sent("2026-11-07")["briefing"], sent("2026-11-09")["briefing"]
    f7, f9 = F.number_fact(n7["one_number"]), F.number_fact(n9["one_number"])
    ok(f7 and f9 and f7["kind"] == f9["kind"] == "funds" and f7["key"] == f9["key"] == "corn",
       "Nov 7's -72,318 and Nov 9's 8,795 are one fact (funds, corn): %r %r" % (f7, f9))
    rec9 = F.recent(D("2026-11-09"))
    hits9 = F.hits(n9, rec9, D("2026-11-09"))
    ok(any(k == "number" and "Saturday" in w for k, _, w in hits9),
       "Nov 9: the generator sends 8,795 back (same release, not Saturday): %r" % [h for h in hits9 if h[0] == "number"])
    hits7 = F.hits(n7, F.recent(D("2026-11-07")), D("2026-11-07"))
    ok(not any(k == "number" for k, _, _ in hits7), "Sat Nov 7: the release's first fund number passes: %r" % hits7)
    r1, r8 = sent("2026-11-01")["briefing"], sent("2026-11-08")["briefing"]
    ok(F.number_fact(r1["one_number"])["kind"] == "ratio", "the 2.48 new-crop ratio is a ratio fact")
    ok(any(k == "number" for k, _, _ in F.hits(r1, F.recent(D("2026-11-01")), D("2026-11-01"))),
       "Nov 1: ratio 2.48 the day after 2.48 is held")
    mem = F.memory(D("2026-11-09"))
    ok(any(m["kind"] == "funds" and m["date"] == "2026-11-07" for m in mem), "the memory reads Nov 7's fund number from the sent copy")
    b9 = build(n9, "2026-11-09", memory=mem)
    ok(not any("8,795" in t for t in today_texts(b9)) and "8,795" not in b9["subject"],
       "Nov 9 email: 8,795 is in neither the subject nor Today: %r / %r" % (b9["subject"], today_texts(b9)))
    # the printed list goes into the sent copy and is read back as memory
    with tempfile.TemporaryDirectory() as td:
        sd, ad = os.path.join(td, "sent"), os.path.join(td, "arch")
        os.makedirs(sd)
        os.makedirs(ad)
        pr = [{"kind": "percentile", "key": "feeders", "value": 74, "text": "Feeders at the 74th percentile"}]
        json.dump({"date": "2026-11-07", "briefing": {}, "printed": pr}, open(os.path.join(sd, "2026-11-07.json"), "w"))
        m = F.memory(D("2026-11-08"), sd, ad)
        ok([(x["kind"], x["key"], x["value"], x["date"]) for x in m] == [("percentile", "feeders", 74, "2026-11-07")],
           "a sent copy's printed list is the next day's memory: %r" % m)
        ok(F.memory(D("2026-11-07"), sd, ad) == [], "the day itself is never its own memory")
    ok(isinstance(b9.get("printed"), list) and all({"kind", "key", "value"} <= set(p) for p in b9["printed"]),
       "build returns the facts it printed: %r" % b9.get("printed"))

    # ── 2 and 10. the state basis line ──────────────────────────────────────
    rows = nov9_rows()
    keys = {"%s:%s" % (r["st"], r["crop"]): r for r in rows}
    ok(set(keys) == {"OH:corn", "OH:soybeans", "IN:corn", "IN:soybeans", "NE:soybeans", "KS:soybeans"},
       "Nov 9 gates (5 cents, 30 bids, 8 companies): %s" % sorted(keys))
    ok(keys["OH:corn"]["wow"] == 10.0 and keys["OH:corn"]["moved"] == 43 and keys["OH:corn"]["n"] == 50,
       "Ohio corn +10 cents, 43 of 50 bids moved (recomputed from the send-day file)")
    ok(not any(r["st"] == "ND" for r in rows), "North Dakota (0.0 on 42 and 44 bids) is not printed")
    ok(not any(r["st"] == "CO" for r in rows), "Colorado +5 on 6 bids and 5 companies fails the sample gates")
    txt = OH.wow_text(rows)
    ok(txt == "Basis firmed this week: Ohio soybeans +15¢ (36 of 45 bids moved), Ohio corn +10¢ (43 of 50) "
              "and Indiana soybeans +10¢ (27 of 30).", "Nov 9 no-ZIP line: %r" % txt)
    ok(OH.wow_text(rows, "IN").startswith("Basis firmed this week: Indiana soybeans +10¢ (27 of 30 bids moved), Indiana corn"),
       "an Indiana reader's state first: %r" % OH.wow_text(rows, "IN"))
    ok(not any(w in txt for w in ("Co-op", "Coop", "Cargill", "ADM", "Grain Co")), "no buyer names")
    w9 = {k: r["wow"] for k, r in keys.items()}
    ok(F.wow_should_print(w9, {})[0], "Nov 9: first print")
    ok(not F.wow_should_print(w9, dict(w9))[0], "the next day, the same states and moves: quiet")
    ok(not F.wow_should_print(dict(w9, **{"OH:corn": 13.5}), w9)[0], "Ohio corn +3.5 more: still quiet (under 5)")
    ok(F.wow_should_print(dict(w9, **{"IN:corn": 11.0}), w9)[0], "Indiana corn 6 to 11: prints (moved 5)")
    ok(F.wow_should_print(dict(w9, **{"MN:corn": -6.0}), w9)[0], "Minnesota enters: prints")
    left = dict(w9)
    left.pop("OH:corn")
    ok(F.wow_should_print(left, w9)[0], "Ohio corn leaves: prints")
    ok(not F.wow_should_print({}, w9)[0], "nothing passes: a quiet week, nothing printed")
    stale = OH.wow_rows(fix("basis-states-2026-11-09.json"), datetime(2026, 11, 11, 11, 0, tzinfo=timezone.utc))
    ok(stale[0] == [], "a snapshot over 36 hours old is not read: %s" % stale[1])
    # the memory reads it from the archived issue, and the generator's last_set returns the last print
    mem2 = F.memory_from([{"_date": "2026-11-09", "basis_wow": {"print": True, "rows": rows}},
                          {"_date": "2026-11-10", "basis_wow": {"print": False, "rows": rows}}])
    ok(F.last_set(mem2, "basis_wow", D("2026-11-11")) == w9, "last printed set is Nov 9's (Nov 10 was quiet)")
    # 10. the no-ZIP Today slot
    nw = dict(n9, basis_wow={"print": True, "rows": rows})
    bw = build(nw, "2026-11-09", memory=mem)
    ok(len(bw["items"]) >= 2 and bw["items"][1]["kind"] == "basis_wow" or (len(bw["items"]) == 1 and bw["items"][0]["kind"] == "basis_wow"),
       "no-ZIP reader: the state basis line takes the second Today slot: %r" % today_texts(bw))
    bq = build(dict(n9, basis_wow={"print": False, "rows": rows}), "2026-11-09", memory=mem)
    ok(not any(x["kind"] == "basis_wow" for x in bq["items"]) and len(bq["items"]) == len(bw["items"]) - 1,
       "a quiet week: nothing takes the slot: %r" % today_texts(bq))
    ok("North Dakota" not in bw["text"] and "North Dakota" not in bq["text"], "the North Dakota line is gone from the email")
    ok(not any(x.get("kind") == "basis_history" for x in OH.for_reader("2026-11-09", None)), "only_here no longer makes it")

    # ── 3. funds: Saturday only, as the streak ──────────────────────────────
    cf = fix("cot-2026-11-07.json")
    fl = V.funds_item(D("2026-11-07"), cf["cot"], cf["hist"])
    ok(fl and fl["text"] == "Funds have sold corn 7 weeks running: net 8,795 contracts long as of Nov 3, "
                           "down 405,665 since Sep 15 (CFTC).", "Sat Nov 7 funds line: %r" % (fl and fl["text"]))
    ok(V.funds_item(D("2026-11-09"), cf["cot"], cf["hist"]) is None, "Mon Nov 9: no funds line")
    ok(V.funds_item(D("2026-11-14"), cf["cot"], cf["hist"]) is None, "Sat Nov 14 with the same report: stale, nothing")
    turn = copy.deepcopy(cf)
    turn["hist"]["history"]["corn"].append({"date": "2026-11-10", "net": 20000})
    turn["cot"]["report_date"], turn["cot"]["corn"]["net"] = "November 10, 2026", 20000
    # the Nov 10 report comes out Monday Nov 16 (Veterans Day week): the Saturday after, Nov 21, carries it
    ok(V.funds_item(D("2026-11-14"), turn["cot"], turn["hist"]) is None, "Sat Nov 14: the Nov 10 report is not out yet")
    t = V.funds_item(D("2026-11-21"), turn["cot"], turn["hist"])
    ok(t and t["text"].startswith("Funds turned and bought corn in the week to Nov 10: net 20,000 contracts long"),
       "the next release, after the turn, prints on the Saturday after a Monday release: %r" % (t and t["text"]))
    ok(M.FUND_DAYS == (5,), "the writer's fund block is Saturday only")

    # ── 4. overnight: 5 cents or more, never on a weekend ────────────────────
    a9 = arch("2026-11-09")
    on9 = [x for x in V.market_items(a9)[0] if x.get("overnight")]
    ok(on9 and not V.overnight_news(a9, on9[0], D("2026-11-09")), "Nov 9: corn +1½, beans +1: no overnight line")
    for d in ("2026-11-07", "2026-11-08"):
        a = arch(d)
        on = [x for x in V.market_items(a)[0] if x.get("overnight")]
        ok(on and on[0]["text"].startswith("Friday's settle") and not V.overnight_news(a, on[0], D(d)),
           "%s: the weekend Friday's settle line is cut" % d)
        ok(not any(t.startswith("Friday's settle") for t in today_texts(build(sent(d)["briefing"], d))),
           "%s email: no Friday's settle line in Today" % d)
    big = copy.deepcopy(a9)
    big["locked_prices"]["corn-dec"] = big["locked_prices"]["corn"] = big["locked_changes"]["corn-dec"]["prev"] + 0.06
    onb = [x for x in V.market_items(big)[0] if x.get("overnight")]
    ok(onb and V.overnight_news(big, onb[0], D("2026-11-09")), "a 6 cent weekday move prints the overnight line")

    # ── 5. ratio and percentile: a band cross or a real move since last printed ──
    mp = [{"kind": "percentile", "key": "feeders", "value": 74, "date": "2026-11-07"}]
    pf = {"kind": "percentile", "key": "feeders", "value": 74}
    ok(not F.still_news(pf, [], D("2026-11-07"))[0], "Nov 7: feeders 74th, middle band and never printed: a standing fact, cut")
    ok(F.still_news(dict(pf, value=93), [], D("2026-11-07"))[0], "a never-printed 93rd percentile (top tenth) prints")
    for d in ("2026-11-08", "2026-11-09"):
        ok(not F.still_news(pf, mp, D(d))[0], "%s: feeders 74th again is cut" % d)
    ok(F.still_news(dict(pf, value=80), mp, D("2026-11-09"))[0], "feeders 74th to 80th (6 points) prints")
    ok(not F.still_news(dict(pf, value=78), mp, D("2026-11-09"))[0], "74th to 78th (4 points) is cut")
    ok(F.still_news(dict(pf, value=91), [dict(mp[0], value=88)], D("2026-11-09"))[0], "88th to 91st crosses the top tenth: prints")
    rmem = [{"kind": "ratio", "key": F.number_fact(r1["one_number"])["key"], "value": 2.48, "date": "2026-11-01"}]
    f8 = F.number_fact(r8["one_number"])
    ok(f8["key"] == rmem[0]["key"] and F.still_news(f8, rmem, D("2026-11-08"))[0],
       "Nov 8: 2.43 after 2.48 is a 0.05 move and prints (the rule: 0.05 or more)")
    ok(not F.still_news(dict(f8, value=2.46), rmem, D("2026-11-08"))[0], "2.46 after 2.48 is cut")
    ok(F.still_news(dict(f8, value=2.51), rmem, D("2026-11-08"))[0], "2.48 to 2.51 crosses 2.5: prints")
    fill = build(n9, "2026-11-09", memory=mem)
    ok(sum(1 for x in fill["items"] if x["kind"] == "rank") <= V.RANK_FILL, "at most one percentile fills a short list")
    for d in ("2026-11-07", "2026-11-08", "2026-11-09"):
        ok(not any(x["kind"] == "rank" for x in build(sent(d)["briefing"], d, memory=mp)["items"]),
           "%s email: no middle-band percentile fills Today (feeders 74th, cattle 71st)" % d)
    sub8 = build(sent("2026-11-08")["briefing"], "2026-11-08")["subject"]
    ok(sub8 == "Mexico's record corn sale and Monday's crop report lead", "Nov 8: a hard cut never ends on a little word: %r" % sub8)

    # ── 6. cash count: a new trading day with a full sample ─────────────────
    pub = E.load_published(REPO)
    blk = {"facts": [f for f in arch("2026-11-03")["edge"]["facts"] if f["kind"] == "cash_change"]}
    pub_before = {k: v for k, v in pub.items() if v[0] < "2026-11-03"}
    q = E.quiet_repeats(blk, pub_before)
    ok(not q["facts"] and all(w["why"] == "sample" for w in q["withheld"]),
       "Nov 3 issue: Monday Nov 2 on 293 corn and 233 soybean boards is withheld: %r" % q["withheld"])
    b4 = {"facts": [f for f in arch("2026-11-04")["edge"]["facts"] if f["kind"] == "cash_change"]}
    q4 = E.quiet_repeats(b4, {k: v for k, v in pub.items() if v[0] < "2026-11-04"})
    ok(len(q4["facts"]) == 2, "Nov 4 issue: Tuesday Nov 3 on 1,783 boards prints")
    for d in ("2026-11-01", "2026-11-02", "2026-11-08", "2026-11-09"):
        bb = {"schema": E.SCHEMA, "facts": [dict(f) for f in arch(d)["edge"]["facts"] if f["kind"] == "cash_change"]}
        prior = {k: v for k, v in pub.items() if v[0] < d}
        qq = E.quiet_repeats(E.freeze(bb, prior), prior)
        ok(not qq["facts"] and all(w["why"] == "reprint" for w in qq["withheld"]),
           "%s issue: Friday's count is not printed again: %r" % (d, qq["withheld"]))

    # ── 7. month to date, and WASDE in What to watch ────────────────────────
    for d in ("2026-11-07", "2026-11-08"):
        a = arch(d)
        pw = A.price_windows(d, a["quote_strip"]["quotes"], a["locked_changes"])
        ok([w["label"] for w in pw] == ["Week so far"], "%s: month to date equal to week so far is left out: %r" % (d, pw))
    pw9 = A.price_windows("2026-11-09", a9["quote_strip"]["quotes"], a9["locked_changes"])
    ok([w["label"] for w in pw9] == ["Month to date"], "Nov 9 (no week row on a Monday): month to date prints")
    w7 = [d for _w, d in V._watch(n7)]
    ok(not any("WASDE" in d for d in w7), "Nov 7 email: the Nov 10 WASDE is three days off, not in What to watch: %r" % w7)
    ok(any("WASDE" in d for _w, d in V._watch(n9)), "Nov 9 email: the day before, the WASDE is in What to watch")
    ok(V.wasde_watch_ok("Today, 11 a.m.", "WASDE", D("2026-11-10")) and not V.wasde_watch_ok("Tue", "WASDE", D("2026-11-06")),
       "the day of: kept; four days before: cut")

    # ── 8. raw counts leave the Daily page ──────────────────────────────────
    e9 = dict(arch("2026-11-09")["edge"], schema=E.SCHEMA, generated="2026-11-09T10:30:00Z")
    ok(E.for_issue(e9, datetime(2026, 11, 9, 11, 0, tzinfo=timezone.utc)) is None,
       "Nov 9: a block of counts (cash change, over futures) puts nothing on the page")
    ok(not any("basis_spread" in x for x in E.ORDER), "the TX-ND spread is not built")

    # ── 9. subject ranking ──────────────────────────────────────────────────
    ok(n9["one_number"]["value"] == "8,795" and not V.has_verb(n9["one_number"]["unit"]), "fixture: Nov 9's number has no verb")
    loud = dict(n9, one_number={"value": "8,795", "unit": "contracts, funds' net long in corn"})
    s9 = V.subject(loud, None, D("2026-11-09"), None, False)
    ok(s9[1] != "news" or "8,795" not in s9[0], "a bare number never leads: %r" % (s9,))
    n3 = sent("2026-11-03")["briefing"]
    s3 = V.subject(n3, None, D("2026-11-03"), None, False)
    ok(s3[0].startswith("88% soybeans harvested"), "a number with a verb may still lead (Nov 3): %r" % (s3,))
    es = fix("estimates-2026-11-09.json")
    rp = V.report_item(D("2026-11-10"), est=es["est"], wasde=es["wasde"])
    ok(rp and rp["text"] == "USDA WASDE and Crop Production today, 11 a.m. CT.",
       "Nov 10: the report line, no number to beat (no November range in hand): %r" % (rp and rp["text"]))
    s10 = V.subject(n3, None, D("2026-11-10"), None, rp)
    ok(s10[1] == "report" and s10[0].startswith("USDA WASDE"), "a report day outranks the day's number: %r" % (s10,))
    ro = V.report_item(D("2026-10-09"), est=es["est"], wasde=es["wasde"])
    ok(ro and "Corn ending stocks trade range 1.522 to 1.895 billion bu (average 1.677)" in ro["text"],
       "Oct 9: the number to beat when a range published before the day is in hand: %r" % (ro and ro["text"]))
    ok(ro and "177.8" not in ro["text"], "Oct 9: the yield range dated the report day itself is not used (it may postdate the email)")
    ok(V.report_item(D("2026-11-09")) is None, "Nov 9: no report day, no deadline: nothing")
    dl = V.report_item(D("2026-12-10"), est=es["est"], wasde=es["wasde"], events=[{"date": D("2026-12-11"), "summary": "2026 ARC/PLC signup deadline (FSA)"}])
    ok(dl and dl["text"].startswith("USDA WASDE"), "Dec 10 is a WASDE day: the report first")
    dl = V.report_item(D("2026-12-11"), events=[{"date": D("2026-12-11"), "summary": "2026 ARC/PLC signup deadline (FSA)"}])
    ok(dl and dl["text"] == "FSA: 2026 ARC/PLC signup deadline is today, Fri Dec 11.", "a deadline day: %r" % (dl and dl["text"]))

    # ── no em dash in anything new ──────────────────────────────────────────
    for t in (txt, fl and fl["text"], rp and rp["text"], ro and ro["text"]):
        ok(t and "—" not in t, "no em dash: %r" % t)

    print("test_daily_memory: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
