#!/usr/bin/env python3
"""
THE DAILY'S STANDING FACTS AND NUMBERS, PINNED (2026-10-20 panel, C2 A2 F2 F5).

  1. Standing situations older than STALE_SITUATIONS_DAYS are DROPPED from the
     prompt (they used to get only a warning; the Oct 5 issue still wrote
     about the Aug 24 screwworm reopening from a 66-day-old file), and the
     fact check lists what was dropped. Tested on the real file.
  2. Archive leads render **bold** as <strong>, like the body, so no page
     prints raw asterisks.

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


if __name__ == "__main__":
    test_situations()
    test_archive_lead()
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'ALL PASS'}")
    sys.exit(1 if fails else 0)
