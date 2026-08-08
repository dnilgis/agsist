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
try:
    import grade_calls
except Exception:
    grade_calls = None
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
    loaded = {}
    def load(dt):
        if dt not in loaded:
            try:
                loaded[dt] = json.loads((ARCHIVE / f"{dt}.json").read_text())
            except Exception as e:
                print(f"[scorecard] skip {dt}: {e}"); loaded[dt] = None
        return loaded[dt]

    # Words a briefing might use for each instrument, so we can tell whether the
    # published prose is even about the call we scored.
    _WORDS = {"corn": ("corn",), "beans": ("bean", "soybean"), "wheat": ("wheat",),
              "cattle": ("cattle",), "feeders": ("feeder",), "hogs": ("hog",),
              "crude": ("crude", "oil"), "natgas": ("natural gas", "natgas")}

    def _summary_mentions(summary, instrument):
        low = summary.lower()
        return any(w in low for w in _WORDS.get(instrument, (instrument,)))

    def _plain_call(call, p0, p1, outcome):
        """Reader-facing description built from the structured call itself."""
        names = {"corn": "corn", "beans": "soybeans", "wheat": "wheat",
                 "cattle": "cattle", "feeders": "feeder cattle", "hogs": "hogs",
                 "crude": "crude", "natgas": "natural gas"}
        inst = names.get((call.get("instrument") or "").lower(), call.get("instrument"))
        d = (call.get("direction") or "").lower()
        lvl = call.get("level")
        way = "up toward" if d == "up" else "down toward"
        got = f" It closed at ${p1}." if p1 is not None else ""
        made = f" (${p0} when the call was made)" if p0 is not None else ""
        return f"Called {inst} {way} ${lvl}{made}.{got}"

    for i, d in enumerate(dates):
        briefing = load(d)
        if briefing is None:
            continue
        yc = briefing.get("yesterdays_call") or {}
        summary = (yc.get("summary") or "").strip()
        stored = (yc.get("outcome") or "").strip()

        # Bulletproof: recompute the outcome from the structured call + actual
        # closes (direction AND level). The public record cannot show a miss as a
        # win even if a bad outcome reached the archive. Falls back to the stored
        # value only when no structured call exists (legacy entries).
        outcome = stored
        _computed_call = _p0v = _p1v = None
        prior = load(dates[i - 1]) if i > 0 else None
        if grade_calls is not None and prior is not None:
            computed, _c, _p0, _p1, _n = grade_calls.grade_from_archives(briefing, prior)
            _computed_call, _p0v, _p1v = _c, _p0, _p1
            if computed in VALID:
                if stored and stored != computed:
                    print(f"[scorecard] {d}: stored outcome '{stored}' -> recomputed '{computed}'")
                    # Show the correction on the record rather than silently
                    # overriding — the published note may tell the old story.
                    _lbl = "played out" if computed == "played_out" else "didn't"
                    _regrade = f" [Regraded {_lbl} by the deterministic checker — direction and level scored against the actual closes; the note above is the text as originally published.]"
                    yc["_regrade_note"] = _regrade
                outcome = computed

        if not summary or outcome not in VALID:
            continue

        # ── Instrument cross-check ────────────────────────────────────────
        # `summary` is the LLM's prose about what it THOUGHT it was grading;
        # `outcome` is recomputed from the PRIOR briefing's structured
        # todays_call. Nothing used to check those were the same call. During
        # the Jun 26 - Aug 4 date bug they diverged on 23 of 40 rows, so the
        # page showed a "played out" badge next to the text of a different,
        # failed call. When they disagree the prose cannot be trusted to
        # describe this grade: publish the deterministic call instead, say so,
        # and keep the original text reachable via the briefing link.
        method = "self" if _computed_call is None else "deterministic"
        mismatch = False
        if _computed_call is not None:
            inst = (_computed_call.get("instrument") or "").lower()
            if inst and not _summary_mentions(summary, inst):
                mismatch = True

        call_text = summary
        note_text = ((yc.get("note") or "").strip() + (yc.get("_regrade_note") or "")).strip()
        if mismatch:
            call_text = _plain_call(_computed_call, _p0v, _p1v, outcome)
            note_text = (
                "The write-up published with this grade described a different call, "
                "a known effect of the grading bug fixed on Aug 4. What is scored here "
                "is the call actually made in the previous briefing, checked against the "
                "closes. The original wording is still in that day's briefing."
            )

        records.append({
            "made": dates[i - 1] if i > 0 else None,
            "judged": d,
            "call": call_text,
            "outcome": outcome,
            "method": method,
            "mismatch": mismatch,
            "note": note_text,
        })

    played = sum(1 for r in records if r["outcome"] == "played_out")
    missed = sum(1 for r in records if r["outcome"] == "didnt")
    pending = sum(1 for r in records if r["outcome"] == "pending")
    graded = played + missed
    hit_rate = round(100.0 * played / graded, 1) if graded else None

    # Two eras, two grading methods. Early records could only be graded by the
    # briefing's own self-report (no structured call was stored yet); later ones
    # are recomputed from the call and the actual closes. Blending them into one
    # headline while the page says "scored deterministically" overstates the
    # record by a wide margin, so publish each separately and let the page lead
    # with the checkable one.
    def _rate(rs):
        pl = sum(1 for r in rs if r["outcome"] == "played_out")
        ms = sum(1 for r in rs if r["outcome"] == "didnt")
        g = pl + ms
        return {"played": pl, "missed": ms, "graded": g,
                "hit_rate": round(100.0 * pl / g, 1) if g else None,
                "first": rs[0]["judged"] if rs else None,
                "last": rs[-1]["judged"] if rs else None}

    det = [r for r in records if r.get("method") == "deterministic"]
    slf = [r for r in records if r.get("method") != "deterministic"]
    by_method = {"deterministic": _rate(det), "self_reported": _rate(slf)}
    mismatched = sum(1 for r in records if r.get("mismatch"))

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
        "by_method": by_method,
        "mismatched": mismatched,
        "current_streak": streak,
        "records": list(reversed(records)),   # newest first for the page
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    d_, s_ = by_method["deterministic"], by_method["self_reported"]
    print(f"[scorecard] method split — deterministic {d_['played']}/{d_['graded']} "
          f"({d_['hit_rate']}%) {d_['first']}..{d_['last']} | self-reported "
          f"{s_['played']}/{s_['graded']} ({s_['hit_rate']}%) {s_['first']}..{s_['last']}"
          + (f" | {mismatched} rows re-described from the structured call" if mismatched else ""))
    print(f"[scorecard] {len(records)} calls — {played} played out, "
          f"{missed} didn't, {pending} pending"
          + (f", hit rate {hit_rate}%" if hit_rate is not None else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
