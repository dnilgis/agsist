#!/usr/bin/env python3
"""
build_scorecard.py — compile the public Yesterday's-Call track record
═══════════════════════════════════════════════════════════════════════════
Walks data/daily-archive/*.json in date order. Each briefing's
yesterdays_call block judges the forward call made in the PREVIOUS
briefing, so day i's yc produces a record dated to publish-day i-1 and
judged on day i.

Honest by construction: outcomes come straight from the archive — the same
JSON the public briefing pages render — and nothing here can edit them.
Misses (outcome "didnt") are included exactly like hits.

Output: data/scorecard.json
  {
    updated, total, played_out, didnt, pending,
    hit_rate            (played / (played + didnt), pct, 1dp; null if no graded calls),
    current_streak      (consecutive most-recent played_out, graded calls only),
    records: [ {made, judged, call, outcome, note}, ... newest first ]
  }

Runs in daily.yml after the briefing publishes. Exit 0 ok, 2 nothing to build.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
ARCHIVE = REPO_ROOT / "data" / "daily-archive"
OUT = REPO_ROOT / "data" / "scorecard.json"

VALID = {"played_out", "didnt", "pending"}


def main():
    if not ARCHIVE.exists():
        print("[scorecard] no archive dir"); sys.exit(2)
    dates = sorted(p.stem for p in ARCHIVE.glob("*.json") if p.stem != "index")
    if not dates:
        print("[scorecard] no archive briefings"); sys.exit(2)

    records = []
    for i, d in enumerate(dates):
        try:
            briefing = json.loads((ARCHIVE / f"{d}.json").read_text())
        except Exception as e:
            print(f"[scorecard] skip {d}: {e}")
            continue
        yc = briefing.get("yesterdays_call") or {}
        summary = (yc.get("summary") or "").strip()
        outcome = (yc.get("outcome") or "").strip()
        if not summary or outcome not in VALID:
            continue
        records.append({
            "made": dates[i - 1] if i > 0 else None,
            "judged": d,
            "call": summary,
            "outcome": outcome,
            "note": (yc.get("note") or "").strip(),
        })

    played = sum(1 for r in records if r["outcome"] == "played_out")
    missed = sum(1 for r in records if r["outcome"] == "didnt")
    pending = sum(1 for r in records if r["outcome"] == "pending")
    graded = played + missed
    hit_rate = round(100.0 * played / graded, 1) if graded else None

    streak = 0
    for r in reversed(records):          # newest graded first
        if r["outcome"] == "pending":
            continue
        if r["outcome"] == "played_out":
            streak += 1
        else:
            break

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(records),
        "played_out": played,
        "didnt": missed,
        "pending": pending,
        "hit_rate": hit_rate,
        "current_streak": streak,
        "records": list(reversed(records)),   # newest first for the page
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"[scorecard] {len(records)} calls — {played} played out, "
          f"{missed} didn't, {pending} pending"
          + (f", hit rate {hit_rate}%" if hit_rate is not None else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
