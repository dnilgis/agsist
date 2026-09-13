#!/usr/bin/env python3
"""
build_scorecard.py — compile the public Yesterday's-Call track record
═══════════════════════════════════════════════════════════════════════════
Walks the CALLS in data/daily-archive/*.json. Each call is scored against the
first later issue whose board holds a later session (grade_calls.grading_issue_for),
so a record is dated to the publish day that made the call and judged on the day
a new close actually arrived.

REBUILT 2026-09-13. This used to walk DAYS and score each briefing's call against
the file immediately before it. The archive publishes at weekends and on holidays
and those issues carry the last close forward, so 20 of 81 graded calls were
scored against the very board they were made from: p0 == p1, direction can never
be satisfied, recorded as a miss before any market opened. Nothing was red — the
row count was right and the outcome was a valid enum.

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

    # v5.1: the reader-facing call sentence is grade_calls.plain_call — one
    # definition, shared with the generator and the renderers. The local copy
    # that used to live here is gone.
    def _plain_call(call, p0, p1, outcome):
        if grade_calls is None:
            return ""
        return grade_calls.plain_call(call, p0, p1, outcome)

    # Iterate CALLS, not days: one row per call, judged by the issue that
    # actually carried a later close. A call with no later session yet simply
    # has no row (it is pending), rather than being scored against a frozen board.
    call_dates = []
    for d in dates:
        b = load(d)
        if b and isinstance(b.get("todays_call"), dict) and (b["todays_call"].get("instrument")):
            call_dates.append(d)

    # ── THE LEGACY ERA, PRESERVED ─────────────────────────────────────────
    # Structured calls (todays_call) begin 2026-06-23. Before that the briefing
    # made prose calls and graded them itself; there is no structured call to
    # recompute, so those rows are carried forward exactly as published and stay
    # fenced off in by_method.self_reported, which is what the page already
    # leads away from. Rebuilding the deterministic era must not quietly delete
    # five weeks of the public record.
    FIRST_STRUCTURED = call_dates[0] if call_dates else None
    for i, d in enumerate(dates):
        if FIRST_STRUCTURED and d > FIRST_STRUCTURED:
            break
        if i == 0:
            continue
        b = load(d)
        if not b:
            continue
        lyc = b.get("yesterdays_call") or {}
        lsummary = (lyc.get("summary") or "").strip()
        loutcome = (lyc.get("outcome") or "").strip()
        if not lsummary or loutcome not in VALID:
            continue
        records.append({
            "made": dates[i - 1], "judged": d, "call": lsummary,
            "outcome": loutcome, "method": "self", "mismatch": False,
            "note": (lyc.get("note") or "").strip(),
        })

    for made in call_dates:
        judged = grade_calls.grading_issue_for(made, str(ARCHIVE)) if grade_calls else None
        if judged is None:
            # No later session has settled yet: the call is OPEN, not a miss.
            # Publish it as pending so the newest call is visible on the record
            # instead of disappearing until the next close arrives.
            _b = load(made) or {}
            _c = _b.get("todays_call") or {}
            _p0 = (_b.get("locked_prices") or {}).get(
                grade_calls.locked_key(_c.get("instrument")) if grade_calls else None)
            records.append({
                "made": made, "judged": None,
                "call": (grade_calls.plain_call(_c, _p0, None, "pending")
                         if grade_calls else ""),
                "outcome": "pending", "method": "deterministic", "mismatch": False,
                "note": "Open: no session has settled since this call was made.",
                "instrument": (grade_calls.locked_key((_c.get("instrument") or "").lower())
                               if grade_calls else None) or (_c.get("instrument") or "").lower(),
                "direction": (_c.get("direction") or "").lower(),
                "level": _c.get("level"), "p0": _p0, "p1": None,
                "design": _c.get("design") or "v1",
            })
            continue
        d = judged
        briefing = load(judged)
        prior_call_issue = load(made)
        if briefing is None or prior_call_issue is None:
            continue
        yc = briefing.get("yesterdays_call") or {}
        # The published prose belongs to this row only if that issue was in fact
        # grading THIS call. Under the old rule it often was not.
        _yc_made = ((yc.get("computed") or {}).get("made"))
        if _yc_made and _yc_made != made:
            yc = {}
        # v5.1: issues after the cut carry no model summary; the row's text is
        # the deterministic call_line (or is rebuilt below from the computed
        # call). Issues before the cut still carry summary and are checked
        # against the computed instrument as before.
        summary = (yc.get("summary") or "").strip()
        call_line = (yc.get("call_line") or "").strip()
        stored = (yc.get("outcome") or "").strip()

        # Bulletproof: recompute the outcome from the structured call + actual
        # closes (direction AND level). The public record cannot show a miss as a
        # win even if a bad outcome reached the archive. Falls back to the stored
        # value only when no structured call exists (legacy entries).
        outcome = stored
        _computed_call = _p0v = _p1v = None
        prior = prior_call_issue
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

        if outcome not in VALID:
            continue
        if not summary and not call_line and _computed_call is None:
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
        if _computed_call is not None and summary:
            inst = (_computed_call.get("instrument") or "").lower()
            if inst and not _summary_mentions(summary, inst):
                mismatch = True

        call_text = summary or call_line
        if not call_text and _computed_call is not None:
            call_text = _plain_call(_computed_call, _p0v, _p1v, outcome)
        note_text = ((yc.get("note") or "").strip() + (yc.get("_regrade_note") or "")).strip()
        if mismatch:
            call_text = _plain_call(_computed_call, _p0v, _p1v, outcome)
            note_text = (
                "The write-up published with this grade described a different call, "
                "a known effect of the grading bug fixed on Aug 4. What is scored here "
                "is the call actually made in the previous briefing, checked against the "
                "closes. The original wording is still in that day's briefing."
            )

        rec = {
            "made": made,
            "judged": judged,
            "call": call_text,
            "outcome": outcome,
            "method": method,
            "mismatch": mismatch,
            "note": note_text,
        }
        # v2 (2026-08-10): carry the structured call on the record so the
        # feedback loop (call_calibration.feedback_block) and the new splits
        # below don't have to re-parse prose. Also mark which CALL DESIGN
        # produced it — v1 = uncalibrated levels, v2 = vol-scaled bands —
        # the same series-split precedent as by_method: never blend eras.
        if _computed_call is not None:
            _raw_inst = (_computed_call.get("instrument") or "").lower()
            # normalize through the grader's own mapping so "soybeans" and
            # "beans" are one instrument in every split, not two.
            rec["instrument"] = (grade_calls.locked_key(_raw_inst) if grade_calls else None) or _raw_inst
            rec["direction"] = (_computed_call.get("direction") or "").lower()
            rec["level"] = _computed_call.get("level")
            rec["p0"] = _p0v
            rec["p1"] = _p1v
            rec["design"] = (((prior or {}).get("todays_call")) or {}).get("design") or "v1"
            # direction-only sub-grade: same closes, level ignored. Published
            # so readers can see whether misses were wrong-way or just
            # short-of-level — the two failure modes mean different things.
            if _p0v is not None and _p1v is not None and rec["direction"] in ("up", "down"):
                rec["direction_ok"] = (_p1v > _p0v) if rec["direction"] == "up" else (_p1v < _p0v)
        records.append(rec)

    # Two passes append to `records` (legacy era, then calls), so order the list
    # explicitly rather than relying on the order they happened to run in.
    records.sort(key=lambda r: (r.get("judged") or r.get("made") or ""))

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
                # Span of the GRADED rows: a pending row has no judged date and
                # must not blank out the era's range.
                "first": next((r["judged"] for r in rs if r.get("judged")), None),
                "last": next((r["judged"] for r in reversed(rs) if r.get("judged")), None)}

    det = [r for r in records if r.get("method") == "deterministic"]
    slf = [r for r in records if r.get("method") != "deterministic"]
    by_method = {"deterministic": _rate(det), "self_reported": _rate(slf)}
    mismatched = sum(1 for r in records if r.get("mismatch"))

    # v2 additions — every one computed from `records`, nothing hand-fed.
    # by_design: v1 (uncalibrated levels) vs v2 (vol-scaled bands, from
    # 2026-08-13). The v1 series is frozen history; v2 starts at zero in
    # public, exactly as by_method did when deterministic grading began.
    by_design = {
        "v1": _rate([r for r in det if r.get("design", "v1") == "v1"]),
        "v2": _rate([r for r in det if r.get("design") == "v2"]),
    }
    # direction-only: same closes, level ignored — separates "wrong way"
    # from "right way, short of the line".
    dgr = [r for r in det if "direction_ok" in r]
    direction_only = {
        "right_way": sum(1 for r in dgr if r["direction_ok"]),
        "graded": len(dgr),
        "rate": round(100.0 * sum(1 for r in dgr if r["direction_ok"]) / len(dgr), 1) if dgr else None,
    }
    by_instrument = {}
    for r in det:
        k = r.get("instrument")
        if not k:
            continue
        g = by_instrument.setdefault(k, {"played": 0, "graded": 0})
        if r["outcome"] in ("played_out", "didnt"):
            g["graded"] += 1
            g["played"] += 1 if r["outcome"] == "played_out" else 0
    for g in by_instrument.values():
        g["hit_rate"] = round(100.0 * g["played"] / g["graded"], 1) if g["graded"] else None
    # trailing-20: the drift needle for "is the briefing getting better".
    t20 = [r for r in det if r["outcome"] in ("played_out", "didnt")][-20:]
    trailing20 = {
        "played": sum(1 for r in t20 if r["outcome"] == "played_out"),
        "graded": len(t20),
        "hit_rate": round(100.0 * sum(1 for r in t20 if r["outcome"] == "played_out") / len(t20), 1) if t20 else None,
    }

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
        "by_design": by_design,
        "direction_only": direction_only,
        "by_instrument": by_instrument,
        "trailing20": trailing20,
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
