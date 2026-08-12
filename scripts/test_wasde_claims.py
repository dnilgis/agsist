#!/usr/bin/env python3
"""
test_wasde_claims.py — selftests for the fabricated-release gate check
(2026-08-11 incident: "WASDE DELIVERS" shipped a day before the report).

The primary fixture IS the actual defective briefing text from Aug 11.
Run: python3 scripts/test_wasde_claims.py   (exit 0 pass / 1 fail)
Control: run against the pre-fix briefing_gate.py — every 'blocks' case
passes there (no check existed), proving these tests bite.
"""
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import briefing_gate  # noqa: E402
import usda_dates     # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  ok    {name}")
    else:
        FAIL += 1; print(f"  FAIL  {name}  {detail}")


def gate_codes(daily, today):
    ok, issues = briefing_gate.run(daily, prices=None, today=today, archive_dir="/nonexistent")
    return {c for s, c, _ in issues if s == "FAIL"}, issues


BASE = {"date": "2026-08-11", "generated_at": "2026-08-11T11:47:30+00:00",
        "locked_prices": {}, "sections": []}


def daily_with(**kw):
    d = dict(BASE); d.update(kw); return d


def main():
    print("usda_dates")
    check("next_wasde from Aug 11 is Aug 12", usda_dates.next_wasde(date(2026, 8, 11)) == date(2026, 8, 12))
    check("results not public on Aug 11", not usda_dates.wasde_results_are_public(date(2026, 8, 11)))
    check("results not public 6am on WASDE day",
          not usda_dates.wasde_results_are_public(date(2026, 8, 12),
              __import__("datetime").datetime(2026, 8, 12, 11, 47)))
    check("results public after the print on WASDE day",
          usda_dates.wasde_results_are_public(date(2026, 8, 12),
              __import__("datetime").datetime(2026, 8, 12, 17, 30)))
    check("results public the day after", usda_dates.wasde_results_are_public(date(2026, 8, 13)))

    print("blocks — the real Aug 11 text")
    d = daily_with(
        headline="WASDE DELIVERS; CORN FLAT, BEANS SPLIT",
        subheadline="The August WASDE printed Tuesday morning; December corn held $4.62.",
        lead="The WASDE landed and December corn didn't flinch, flat at $4.62.",
        weekly_thread={"question": "q", "day": 2,
                       "status_text": "WASDE confirmed the crop; December corn sat flat at $4.62."})
    codes, issues = gate_codes(d, "2026-08-11")
    check("Aug 11 briefing BLOCKED", "wasde-fabricated" in codes,
          str([m for s, c, m in issues][:2]))
    hits = [m for s, c, m in issues if c == "wasde-fabricated"]
    check("headline+lead+thread all caught", len(hits) >= 3, f"{len(hits)} hits")

    print("blocks — WASDE-day morning past tense")
    d = daily_with(date="2026-08-12", generated_at="2026-08-12T11:47:00+00:00",
                   lead="The WASDE printed and corn broke lower.")
    codes, _ = gate_codes(d, "2026-08-12")
    check("6am release-day past tense blocked", "wasde-fabricated" in codes)

    print("allows — legitimate history and anticipation")
    d = daily_with(lead="Back on July 10 the July WASDE printed a neutral corn number.")
    codes, _ = gate_codes(d, "2026-08-11")
    check("prior-month WASDE past tense allowed", "wasde-fabricated" not in codes)

    d = daily_with(lead="Tomorrow's WASDE at 11 AM CT will set the yield number; the market is positioning.")
    codes, _ = gate_codes(d, "2026-08-11")
    check("anticipation framing allowed", "wasde-fabricated" not in codes)

    d = daily_with(date="2026-08-13", generated_at="2026-08-13T11:47:00+00:00",
                   lead="Yesterday's WASDE landed at 183.5 and corn sold off hard.")
    codes, _ = gate_codes(d, "2026-08-13")
    check("day-after past tense allowed", "wasde-fabricated" not in codes)

    d = daily_with(date="2026-08-12", generated_at="2026-08-12T20:30:00+00:00",
                   lead="The WASDE landed at 11 and corn broke 15 cents by the close.")
    codes, _ = gate_codes(d, "2026-08-12")
    check("post-print regeneration allowed", "wasde-fabricated" not in codes)

    # ── wasde_fabrication_hits() direct — the self-heal entry point ──────
    # Fixture = the SECOND blocked draft from WASDE morning 2026-08-12 (run
    # 85717195150): four distinct fields fabricated. The generator's
    # self-heal imports this function; it must see everything the gate sees.
    print("wasde_fabrication_hits — the 2026-08-12 morning drafts")
    d = daily_with(date="2026-08-12", generated_at="2026-08-12T13:05:00+00:00",
                   lead="The WASDE printed and wheat ran 14 cents.",
                   weekly_thread={"question": "q", "day": 3,
                                  "status_text": "WASDE landed; the yield question is answered."})
    d["sections"] = [{"title": "Corn", "body": "WASDE's corn yield number landed above trade."}]
    d["yesterdays_call"] = {"summary": "s", "note": "WASDE delivered the range we called."}
    hits, nw = briefing_gate.wasde_fabrication_hits(d, "2026-08-12")
    locs = {l for l, _ in hits}
    check("morning draft: >=3 fields hit", len(hits) >= 3, f"{len(hits)}: {sorted(locs)}")
    check("lead is among the hits", any("lead" in l for l in locs), str(sorted(locs)))
    check("thread status_text is among the hits",
          "weekly_thread.status_text" in locs, str(sorted(locs)))
    check("next wasde identified", nw is not None and nw.isoformat() == "2026-08-12", str(nw))
    d2 = daily_with(date="2026-08-12", generated_at="2026-08-12T20:30:00+00:00",
                    lead="The WASDE landed at 11 and corn broke 15 cents.")
    hits2, _ = briefing_gate.wasde_fabrication_hits(d2, "2026-08-12")
    check("post-print: hits() returns empty", hits2 == [], str(hits2))

    print()
    print(f"wasde-claims selftest: {PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
