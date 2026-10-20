#!/usr/bin/env python3
"""
THE DAILY'S STANDING FACTS AND NUMBERS, PINNED (2026-10-20 panel, C2 A2 F2 F5).

  1. Standing situations older than STALE_SITUATIONS_DAYS are DROPPED from the
     prompt (they used to get only a warning; the Oct 5 issue still wrote
     about the Aug 24 screwworm reopening from a 66-day-old file), and the
     fact check lists what was dropped. Tested on the real file.
  2. Archive leads render **bold** as <strong>, like the body, so no page
     prints raw asterisks.
  3. A past day's elevator count is frozen the first time an issue prints it
     (Oct 17, 18 and 19 printed three counts for Friday Oct 16), and streak
     words are counted from the settles (Oct 17 said "third straight lower
     close"; Oct 16 was the fourth).
  6. A weekday beside a quoted settle takes the settle's own date (Oct 18:
     "Friday's (Oct 23) $227.55 close" for the Oct 16 settle).

    python3 scripts/test_daily_numbers.py

Fixtures and repo data only: no network, no model call, nothing sent.
"""
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime as _real_dt
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_daily as g  # noqa: E402
import fact_check_briefing as fc  # noqa: E402

REPO = Path(HERE).parent
fails = []


def check(ok, msg, got=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {msg}" + ("" if ok else f"  -- {got!r}"))
    if not ok:
        fails.append(msg)


class _Clock:
    """Set generate_daily's clock (it reads datetime.now()) for a block."""
    def __init__(self, y, m, d, hh=5, mm=30):
        fixed = _real_dt(y, m, d, hh, mm)

        class FakeDT(_real_dt):
            @classmethod
            def now(cls, tz=None):
                return fixed if tz is None else fixed.replace(tzinfo=tz)
        self.fake = FakeDT

    def __enter__(self):
        self.saved = g.datetime
        g.datetime = self.fake

    def __exit__(self, *a):
        g.datetime = self.saved


class _Root:
    """Point generate_daily's REPO_ROOT at a temp tree holding one
    ongoing-situations.json."""
    def __init__(self, data):
        self.data = data

    def __enter__(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "data"))
        with open(os.path.join(self.tmp, "data", "ongoing-situations.json"), "w") as f:
            json.dump(self.data, f)
        self.saved = g.REPO_ROOT
        g.REPO_ROOT = Path(self.tmp)

    def __exit__(self, *a):
        g.REPO_ROOT = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)


def real_situations():
    with open(REPO / "data" / "ongoing-situations.json") as f:
        return json.load(f)


def test_situations():
    print("1. standing situations: stale entries are dropped, not just flagged")
    real = real_situations()
    sits = real["situations"]
    check(len(sits) == 6, "real file still has its six entries", len(sits))
    for k, s in sits.items():
        check(s.get("status") in ("active", "resolved", "expired"), f"{k}: known status", s.get("status"))
        check(bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", s.get("updated") or "")), f"{k}: has its own updated date", s.get("updated"))

    # The real file as it ships, on the day of the fix.
    with _Clock(2026, 10, 20):
        block = g.load_ongoing_situations()
    active_fresh = [k for k, s in sits.items() if s.get("status") == "active"
                    and (_real_dt(2026, 10, 20) - _real_dt.strptime(s["updated"], "%Y-%m-%d")).days <= g.STALE_SITUATIONS_DAYS]
    for k in sits:
        if k not in active_fresh:
            check(f"[{k}]" not in block, f"real file Oct 20: {k} not in the prompt", block[:200])
    check("Aug 24" not in block, "real file Oct 20: no Aug 24 reopening in the prompt", block[:200])

    # The real entries as they stood on Aug 15 (all "active", no per-entry
    # date): on Oct 20 every one is dropped and listed; on Aug 20 all stay.
    as_was = json.loads(json.dumps(real))
    as_was["_last_updated"] = "2026-08-15"
    for s in as_was["situations"].values():
        s["status"] = "active"
        s.pop("updated", None)
    with _Root(as_was), _Clock(2026, 10, 20):
        block = g.load_ongoing_situations()
        dropped = list(g.DROPPED_SITUATIONS)
    check(block == "", "Aug 15 file read Oct 20: nothing reaches the prompt", block[:200])
    check(sorted(d["key"] for d in dropped) == sorted(sits), "Aug 15 file read Oct 20: all six listed as dropped", dropped)
    check(all(d["age_days"] == 66 and d["updated"] == "2026-08-15" for d in dropped),
          "dropped rows carry age 66 and the Aug 15 date", dropped)
    with _Root(as_was), _Clock(2026, 8, 20):
        block = g.load_ongoing_situations()
        dropped = list(g.DROPPED_SITUATIONS)
    check(all(f"[{k}]" in block for k in sits) and not dropped,
          "Aug 15 file read Aug 20: all six stay (5 days old)", (block[:120], dropped))
    check("Standing facts as of 2026-08-15" in block, "kept facts are dated in the prompt", block[:300])

    # Per-entry date beats the file date: one fresh entry stays, one stale goes.
    mixed = json.loads(json.dumps(as_was))
    mixed["_last_updated"] = "2026-10-19"
    mixed["situations"]["farm_bill_2026"]["updated"] = "2026-10-15"
    mixed["situations"]["iran_hormuz"]["updated"] = "2026-08-15"
    with _Root(mixed), _Clock(2026, 10, 20):
        block = g.load_ongoing_situations()
        dropped = [d["key"] for d in g.DROPPED_SITUATIONS]
    check("[farm_bill_2026]" in block and "[iran_hormuz]" not in block and dropped == ["iran_hormuz"],
          "entry date decides: 5-day-old entry kept, 66-day-old entry dropped", (dropped, block[:200]))
    bad = json.loads(json.dumps(as_was))
    bad["_last_updated"] = ""
    with _Root(bad), _Clock(2026, 10, 20):
        block = g.load_ongoing_situations()
    check(block == "" and len(g.DROPPED_SITUATIONS) == 6, "no date at all: dropped, never trusted", block[:100])

    # Resolved and expired are skipped and not listed as dropped.
    with _Root(real), _Clock(2026, 10, 20):
        g.load_ongoing_situations()
    check(all(d["key"] in active_fresh or sits[d["key"]]["status"] == "active" for d in g.DROPPED_SITUATIONS),
          "expired and resolved entries are not reported as dropped", g.DROPPED_SITUATIONS)

    # The fact check's log line.
    line = fc.dropped_situations_line({"dropped_situations": [
        {"key": "cattle_mexico_screwworm", "updated": "2026-08-15", "age_days": 66}]})
    check("cattle_mexico_screwworm (updated 2026-08-15, 66 days old)" in line,
          "fact check names the dropped entry with its age", line)
    check(fc.dropped_situations_line(None) == "" and fc.dropped_situations_line({}) == "",
          "fact check: nothing dropped, no line")
    # And the generator hands the list to the fact check.
    with _Root(as_was), _Clock(2026, 10, 20):
        g.load_ongoing_situations()
    tmp = tempfile.mkdtemp()
    try:
        os.environ["BRIEFING_INPUTS_PATH"] = os.path.join(tmp, "in.json")
        g.save_briefing_inputs("u", "s")
        with open(os.environ["BRIEFING_INPUTS_PATH"]) as f:
            saved = json.load(f)
    finally:
        os.environ.pop("BRIEFING_INPUTS_PATH", None)
        shutil.rmtree(tmp, ignore_errors=True)
    check(len(saved.get("dropped_situations") or []) == 6, "briefing inputs carry the dropped list", saved.keys())


def test_archive_lead():
    print("2. archive leads: **bold** renders as <strong>")
    b = json.load(open(REPO / "data" / "daily-archive" / "2026-10-19.json"))
    check("**" in b.get("lead", ""), "fixture: the Oct 19 lead has ** in the archive JSON")
    html = g.generate_archive_html(b, "2026-10-19")
    lead = re.search(r'<p class="dv3-lead">(.*?)</p>', html, re.S)
    check(lead and "**" not in lead.group(1) and "<strong>$98.41</strong>" in lead.group(1),
          "rendered Oct 19 lead has <strong>$98.41</strong> and no **", lead and lead.group(1)[:200])
    check("&lt;script" in g.html_esc_preserve_strong("<script>x</script> **a**"),
          "lead still escapes other tags")
    for p in sorted((REPO / "daily").glob("20*.html")):
        m = re.search(r'<p class="dv3-lead">(.*?)</p>', p.read_text(encoding="utf-8"), re.S)
        if m and "**" in m.group(1):
            check(False, f"published {p.name} lead has no raw **", m.group(1)[:120])
    check(True, "every published archive lead checked for raw **")


def test_frozen_counts():
    print("3a. a past day's elevator count is printed once")
    import daily_edge as de
    pub = de.load_published(str(REPO))
    hit = pub.get(("cash_change_corn", "2026-10-16"))
    check(hit and hit[0] == "2026-10-17" and hit[1]["key"] == "1,494 of the 1,527 elevators",
          "first print of Friday Oct 16 corn is the Oct 17 issue, 1,494 of 1,527", hit and (hit[0], hit[1].get("key")))
    # The Oct 19 run recounted Friday as 1,596 of 1,629; frozen, it prints the Oct 17 numbers.
    oct19 = json.load(open(REPO / "data" / "daily-archive" / "2026-10-19.json"))["edge"]
    recount = {"schema": de.SCHEMA, "generated": oct19["generated"], "facts": [
        dict(f, **{"from": "2026-10-15"}) if f["kind"] == "cash_change" else dict(f) for f in oct19["facts"]]}
    frozen = de.freeze(recount, pub)
    byid = {f["id"]: f for f in frozen["facts"]}
    check(byid["cash_change_corn"]["key"] == "1,494 of the 1,527 elevators"
          and byid["cash_change_corn"]["n"] == 1527 and byid["cash_change_corn"]["frozen_from"] == "2026-10-17",
          "Oct 19 recount of Friday corn prints the Oct 17 count", byid["cash_change_corn"])
    check(byid["cash_change_soybeans"]["key"] == "1,270 of the 1,328 elevators",
          "Oct 19 recount of Friday soybeans prints the Oct 17 count", byid["cash_change_soybeans"]["key"])
    check("1,596" not in json.dumps(frozen, ensure_ascii=False) and "1,629" not in json.dumps(frozen, ensure_ascii=False),
          "no recounted number rides along in the frozen block")
    check(byid["basis_spread_corn"]["key"] == [f for f in oct19["facts"] if f["id"] == "basis_spread_corn"][0]["key"]
          and "frozen_from" not in byid["basis_spread_corn"],
          "today's basis snapshot is not frozen")
    newday = {"facts": [{"id": "cash_change_corn", "kind": "cash_change", "as_of": "2026-10-19", "key": "x", "n": 1}]}
    check(de.freeze(newday, pub)["facts"][0].get("frozen_from") is None, "a day no issue has printed is counted fresh")
    src = open(os.path.join(HERE, "daily_edge.py")).read()
    check("return freeze(build(" in src, "build_from_files freezes before writing daily-edge.json")

    print("3b. streak words come from the settles")
    import streak_words as sw
    # Dec corn settles from data/harvest-prices.json (October 2026 window).
    dec = {"2026-10-09": 4.875, "2026-10-12": 4.83, "2026-10-13": 4.8275, "2026-10-14": 4.8075,
           "2026-10-15": 4.78, "2026-10-16": 4.7425}
    hp = json.load(open(REPO / "data" / "harvest-prices.json"))
    for w in hp.get("windows") or []:
        if w.get("ticker") == "ZCZ26.CBT":
            real = {p["d"]: p["s"] for p in w["series"]}
            check(all(abs(real.get(d, -1) - v) < 1e-9 for d, v in dec.items() if d != "2026-10-09"),
                  "fixture matches data/harvest-prices.json Oct 12 to 16", {d: real.get(d) for d in dec})
            dec["2026-10-09"] = real.get("2026-10-09", dec["2026-10-09"])
    st = sw.streaks({"corn": {"ticker": "ZCZ26.CBT", "month": "Dec", "label": "Dec corn", "settles": dec}}, "2026-10-16")
    check(st["corn"]["n"] == 4 and st["corn"]["dir"] == "lower" and not st["corn"]["open"],
          "Dec corn through Oct 16: four straight lower closes", st)
    oct17 = json.load(open(REPO / "data" / "daily-archive" / "2026-10-17.json"))
    body = oct17["sections"][0]["body"]
    check("the third straight lower close" in body, "fixture: the Oct 17 issue said third")
    fixed, log = sw.apply({"sections": [{"body": body}]}, st)
    check("the fourth straight lower close" in fixed["sections"][0]["body"] and "third straight" not in fixed["sections"][0]["body"] and log,
          "Oct 17 text corrected to fourth", fixed["sections"][0]["body"][:160])
    gsrc = open(g.__file__).read()
    csrc = open(os.path.join(HERE, "critique_briefing.py")).read()
    check("_sw.apply(briefing, _streaks)" in gsrc and "streak_words.apply(briefing" in csrc,
          "generator and critic both run the streak check")
    check("_sw.prompt_lines(_streaks)" in gsrc, "the model is handed the counts")


def test_watch_dates():
    print("6. a weekday beside a settle takes the settle's date")
    import watch_dates as wd
    oct18 = json.load(open(REPO / "data" / "daily-archive" / "2026-10-18.json"))
    item = [w for w in oct18["watch_list"] if "$227.55" in w.get("desc", "")][0]
    check("Friday's (Oct 23) $227.55" in item["desc"], "fixture: the Oct 18 issue said Friday's (Oct 23)")
    undated = dict(item, desc=item["desc"].replace("Friday's (Oct 23)", "Friday's"))
    # Live cattle settles as data/prices.json carried them on Oct 18-20 2026.
    cattle = [(223.89999389648438, "2026-10-14"), (225.9499969482422, "2026-10-15"), (227.5500030517578, "2026-10-16")]
    b, fx = wd.apply({"watch_list": [undated]}, _real_dt(2026, 10, 18, 10, 0), cattle)
    check("Friday's (Oct 16) $227.55 close" in b["watch_list"][0]["desc"],
          "Oct 18 line dated by the settle: Friday's (Oct 16)", b["watch_list"][0]["desc"])
    got = wd.load_settles(str(REPO / "data" / "prices.json"))
    check(len(got) > 20 and all(isinstance(v, float) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d) for v, d in got),
          "load_settles reads data/prices.json", len(got))


if __name__ == "__main__":
    test_situations()
    test_archive_lead()
    test_frozen_counts()
    test_watch_dates()
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'ALL PASS'}")
    sys.exit(1 if fails else 0)
