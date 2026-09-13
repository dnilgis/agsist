#!/usr/bin/env python3
"""
AGSIST — bring every archived issue's yesterday's-call block to the rule that
grades the public record.

WHY THIS EXISTS
═══════════════════════════════════════════════════════════════════════════
On 2026-09-13 the call-grading rule was corrected: a call is scored by the
first later issue whose board holds a LATER SESSION, not by the file that
happens to come next. `Rebuild Call Scorecard` recomputed data/scorecard.json
under the new rule and the published hit rate moved from 13.6% to 18.8%.

It did not touch the pages. Each archived issue stores its OWN yesterdays_call
block -- outcome, computed p0/p1, and the reader-facing call_line -- written by
the old grader at the time. On 48 of them p0 == p1, because the call was scored
against the very board it was made from. So the record and the archive now
disagreed:

    2026-06-30   page: corn $4.035 -> closed $4.035, DIDN'T
                 record: closed $4.1375
    2026-08-04   page: beans $11.59 -> closed $11.59, DIDN'T
                 record: closed $11.49, PLAYED OUT

Measured before this ran: 32 VISIBLE pages printed a close the record
contradicted, 2 of them the wrong verdict as well, and 22 more were wrong in
the JSON but hidden by the weekend render rule.

WHAT IT DOES
═══════════════════════════════════════════════════════════════════════════
For every archived issue it asks the SAME question the fixed generator asks of
a new one: grade_calls.find_graded_call(issue) -- which call, if any, does this
issue grade? Then grade_calls.grade_from_archives computes the verdict from the
two closes. Both read grade_calls.board_session, which is also what
grading_issue_for uses to build the record, so the pages and the record cannot
disagree about what a session is.

Three outcomes per issue:

  * no call to grade (no session settled since the issue before it)
        -> the block is emptied. It asserted a verdict on a day when nothing
           had closed; the record grades that call on the correct later day,
           and that day's page carries it.
  * a call to grade
        -> outcome, computed{p0,p1,...} and call_line are rewritten from the
           actual closes.
  * nothing changes
        -> the file is not rewritten at all.

THE NOTE IS DROPPED WHENEVER THE NUMBERS MOVE. It is the model's one-sentence
commentary and it states the close in prose -- "Corn closed at $4.035 today",
"Crude ran to $74.58 today, up 3.2%". Once the close is corrected those
sentences are wrong, and a corrected figure sitting beside a sentence that
contradicts it is worse than either alone. Sig's call, 2026-09-13: "correct
numbers and dont worry about the notes, i want it right." A note is kept only
when the verdict and both closes are unchanged, in which case it still
describes what happened.

PRE-STRUCTURED-CALL ISSUES ARE NOT TOUCHED. Before 2026-06-23 the briefing made
prose calls and graded them itself; there is no structured call to recompute,
and build_scorecard carries that era forward verbatim into
by_method.self_reported. An issue whose block has no `computed.made` is left
exactly as published.

Usage:
    python3 scripts/regrade_archive.py            # rewrite what is wrong
    python3 scripts/regrade_archive.py --check    # exit 1 if anything is stale
    python3 scripts/regrade_archive.py --selftest # 14 checks, no repo needed

Idempotent: a second run rewrites nothing. Reads and writes only
data/daily-archive/*.json; the HTML is re-rendered by
scripts/rebuild_archive_html.py, which the same workflow runs next.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REPO_ROOT = HERE.parent
ARCHIVE = REPO_ROOT / "data" / "daily-archive"

import grade_calls  # noqa: E402

VALID = {"played_out", "didnt", "pending"}


def _num(x):
    return x if isinstance(x, (int, float)) else None


def regraded_block(issue, archive_dir):
    """What this issue's yesterdays_call SHOULD hold. Returns (block, reason).

    block is {} when the issue grades nothing. reason is a short string for the
    log -- the point of the run is a reader being able to see why a verdict was
    withdrawn, not just that it was.
    """
    yc = issue.get("yesterdays_call") or {}
    computed = yc.get("computed") or {}
    if yc and not computed.get("made"):
        # Pre-structured era, or a block with no machine grade behind it.
        return yc, "legacy"

    made, prior, why = grade_calls.find_graded_call(issue, str(archive_dir))
    if made is None:
        return {}, why or "no call to grade"

    outcome, call, p0, p1, note = grade_calls.grade_from_archives(issue, prior)
    if outcome not in VALID:
        return {}, "no computable outcome"

    new = dict(yc)
    new["outcome"] = outcome
    new["computed"] = {
        "outcome": outcome, "made": made, "p0": p0, "p1": p1,
        "instrument": call.get("instrument"), "direction": call.get("direction"),
        "level": call.get("level"),
    }
    new["call_line"] = grade_calls.plain_call(call, p0, p1, outcome)

    moved = (outcome != yc.get("outcome")
             or _num(p0) != _num(computed.get("p0"))
             or _num(p1) != _num(computed.get("p1")))
    if moved:
        # The note states the close. A corrected number beside a sentence
        # naming the old one is the worst of both.
        new.pop("note", None)
        new.pop("summary", None)
    return new, ("corrected" if moved else "unchanged")


def run(archive_dir=ARCHIVE, write=True, quiet=False):
    archive_dir = Path(archive_dir)
    files = sorted(p for p in archive_dir.glob("*.json") if p.stem != "index")
    changed, emptied, corrected, untouched = [], [], [], 0
    for p in files:
        try:
            issue = json.loads(p.read_text())
        except (OSError, ValueError) as e:
            if not quiet:
                print(f"  [skip] {p.stem}: {e}")
            continue
        before = issue.get("yesterdays_call") or {}
        after, reason = regraded_block(issue, archive_dir)
        if reason == "legacy" or after == before:
            untouched += 1
            continue
        changed.append(p.stem)
        (emptied if not after else corrected).append(p.stem)
        if not quiet:
            if not after:
                print(f"  [drop] {p.stem}  verdict withdrawn -- {reason}")
            else:
                c0, c1 = before.get("computed") or {}, after["computed"]
                print(f"  [fix ] {p.stem}  {before.get('outcome')}->{after['outcome']}  "
                      f"p0 {c0.get('p0')}->{c1['p0']}  p1 {c0.get('p1')}->{c1['p1']}")
        if write:
            issue["yesterdays_call"] = after
            p.write_text(json.dumps(issue, indent=2, ensure_ascii=False) + "\n")
    return {"files": len(files), "changed": changed,
            "emptied": emptied, "corrected": corrected, "untouched": untouched}


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    check = "--check" in argv
    res = run(write=not check)
    print(f"[regrade] {res['files']} archived issues | "
          f"{len(res['corrected'])} corrected, {len(res['emptied'])} verdicts withdrawn, "
          f"{res['untouched']} already right")
    if check and res["changed"]:
        print("[regrade] FAIL: the archive is out of step with the grading rule. "
              "Run scripts/regrade_archive.py and commit.")
        return 1
    return 0


# ── selftest ───────────────────────────────────────────────────────────────

def _selftest():
    import tempfile
    P = F = 0

    def chk(cond, name, detail=""):
        nonlocal P, F
        if cond:
            P += 1
            print(f"  ok    {name}")
        else:
            F += 1
            print(f"  FAIL  {name}" + (f"  [{detail}]" if detail else ""))

    def issue(d, hour_utc, prices, call=None, yc=None):
        b = {"date": d, "generated_at": f"{d}T{hour_utc:02d}:30:00+00:00",
             "locked_prices": dict(prices)}
        if call:
            b["todays_call"] = call
        if yc is not None:
            b["yesterdays_call"] = yc
        return b

    # Mon 2026-09-07 is Labor Day. Tue 8th, Wed 9th, Thu 10th, Fri 11th.
    TUE = {"corn": 5.00}
    WED = {"corn": 5.10}
    THU = {"corn": 5.25}
    CALL = {"instrument": "corn", "direction": "up", "level": 5.20, "design": "v2"}

    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        # Tue's issue (pre-open) holds MONDAY -- a holiday -- so its board is
        # Friday's. Give it a call; Wed holds Tuesday's close, Thu Wednesday's.
        (t / "2026-09-08.json").write_text(json.dumps(
            issue("2026-09-08", 11, TUE, call=CALL)))
        # Wednesday's issue: pre-open, holds Tuesday's close. It graded the call
        # against ITS OWN board under the old rule -- p0 == p1.
        (t / "2026-09-09.json").write_text(json.dumps(
            issue("2026-09-09", 11, WED, yc={
                "outcome": "didnt",
                "computed": {"outcome": "didnt", "made": "2026-09-08",
                             "p0": 5.00, "p1": 5.00, "instrument": "corn",
                             "direction": "up", "level": 5.20},
                "call_line": "Called corn up toward $5.20 ($5.00 when the call was made). It closed at $5.00.",
                "note": "Corn closed at $5.00 today, nowhere near the line."})))
        (t / "2026-09-10.json").write_text(json.dumps(
            issue("2026-09-10", 11, THU)))

        res = run(t, write=False, quiet=True)
        chk(res["files"] == 3, "walks every archived issue", str(res["files"]))

        wed = json.loads((t / "2026-09-09.json").read_text())
        new, reason = regraded_block(wed, t)
        chk(reason == "corrected", "a p0==p1 block is recognised as wrong", reason)
        chk(new["computed"]["p0"] == 5.00 and new["computed"]["p1"] == 5.10,
            "the closes are rewritten from the two boards", str(new["computed"]))
        chk(new["outcome"] == "didnt",
            "corn rose but never reached $5.20, so it is still a miss", new["outcome"])
        chk("note" not in new,
            "the note goes with the number it described")
        chk("$5.1" in new["call_line"],
            "the reader-facing line carries the real close", new["call_line"])

        # AN ISSUE WITH NOTHING TO GRADE MUST BE EMPTIED, NOT SCORED. Two
        # pre-open issues in a row hold consecutive sessions, so the second one
        # does grade the first's call -- to reach the "nothing settled" case the
        # boards must be identical, which is what a weekend or a holiday does.
        # Sat 2026-09-12 and Sun 09-13 both carry Friday's close.
        (t / "2026-09-11.json").write_text(json.dumps(
            issue("2026-09-11", 11, THU, call=CALL)))          # Fri am -> Thu close
        FRI = {"corn": 5.30}
        (t / "2026-09-12.json").write_text(json.dumps(
            issue("2026-09-12", 13, FRI)))                     # Sat -> Fri close
        (t / "2026-09-13.json").write_text(json.dumps(
            issue("2026-09-13", 13, FRI, yc={
                "outcome": "didnt",
                "computed": {"outcome": "didnt", "made": "2026-09-12",
                             "p0": 5.30, "p1": 5.30},
                "note": "phantom"})))                          # Sun -> Fri close too
        blk, why = regraded_block(json.loads((t / "2026-09-13.json").read_text()), t)
        chk(blk == {},
            "a Sunday holding the same board as Saturday withdraws its verdict", str(blk))
        chk("session" in why.lower(),
            "and the log says no session has settled", why)

        # Legacy blocks are left exactly as published.
        legacy = {"outcome": "played_out", "summary": "Called corn higher.",
                  "note": "It did."}
        wed2 = json.loads((t / "2026-09-09.json").read_text())
        wed2["yesterdays_call"] = legacy
        blk, why = regraded_block(wed2, t)
        chk(blk == legacy and why == "legacy",
            "a pre-structured block is never rewritten", f"{why} {blk}")

        # Write, then prove idempotence and that --check goes quiet.
        r1 = run(t, write=True, quiet=True)
        r2 = run(t, write=True, quiet=True)
        chk(len(r1["changed"]) >= 1, "the first pass changes something", str(r1["changed"]))
        chk(r2["changed"] == [], "the second pass changes nothing", str(r2["changed"]))
        chk(run(t, write=False, quiet=True)["changed"] == [],
            "--check is clean once the archive is in step")

        # And it stays valid JSON with the rest of the issue intact.
        again = json.loads((t / "2026-09-09.json").read_text())
        chk(again.get("locked_prices") == WED,
            "nothing outside yesterdays_call is touched", str(again.get("locked_prices")))
        chk(again.get("generated_at", "").startswith("2026-09-09"),
            "including the timestamp the session rule depends on")

    print()
    print(f"regrade_archive selftest: {P} passed, {F} failed")
    return 1 if F else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
