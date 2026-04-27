#!/usr/bin/env python3
"""
AGSIST Daily — Critic Pass (v1.0)
═══════════════════════════════════════════════════════════════════
Runs as the second step in the morning cron, after generate_daily.py.

Reads the just-generated data/daily.json. Sends the briefing back to
Claude as an editor. The editor scores 1-10 on each of the 11 IMPACT
RULES plus the Forward Test and the Voice Test. If 2+ rules score
below 7, the editor rewrites the weakest section (or lead, or basis,
or yesterdays_call, or weekly_thread.status_text) and the result is
re-saved + re-archived.

This is the quality gate that keeps the rules from drifting after
the first three weeks. Without it, the editorial spine softens.

Env vars required:
  ANTHROPIC_API_KEY

Usage:
  python scripts/critique_briefing.py
  python scripts/critique_briefing.py --dry-run    (score only, no rewrite)
  python scripts/critique_briefing.py --threshold 8 (default 7)
  python scripts/critique_briefing.py --max-rewrites 1 (default 1; how many
       sections allowed to be rewritten in a single pass)
"""

import json
import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    import urllib.request
    requests = None

REPO_ROOT = Path(__file__).resolve().parent.parent
DAILY_PATH = REPO_ROOT / "data" / "daily.json"
ARCHIVE_DIR = REPO_ROOT / "data" / "daily-archive"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"

# Make the generator importable so we can re-archive after rewrite
sys.path.insert(0, str(REPO_ROOT / "scripts"))


def http_post_json(url, payload, headers, timeout=60):
    if requests:
        r = requests.post(url, json=payload, headers=headers, timeout=timeout)
        r.raise_for_status()
        return r.json()
    data_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


CRITIC_SYSTEM = """You are the editor of AGSIST Daily, a morning agricultural intelligence briefing read every weekday by US grain and livestock producers. You are reviewing a draft before it ships at 6 AM CT.

Your job is honest, calibrated scoring against the AGSIST editorial standard. You are NOT here to be encouraging. You are here to catch drift before subscribers see it.

══ THE 13 RULES YOU SCORE 1-10 ══

1. LEAD DELIVERS A "SO WHAT". Specific price + synthesizing observation. Not a wire-service recap.

2. CONVICTION EARNED. "Medium" labels must justify themselves. Default-to-low on quiet days is GOOD calibration.

3. TMYK TIES TO TODAY'S DATA. Opens with a hook tied to a number from today's briefing. Generic ag-history filler scores low.

4. WATCH LIST CONDITIONAL. At least HALF of items must include a specific level, threshold, or trigger. Calendar-only entries are weakest.

5. BOTTOM LINES SYNTHESIZE. Add information beyond the section title. If the bottom line is restating the section title, score it low.

6. QUIET DAYS QUIET. Manufactured drama on a flat day is a serious failure. Did the briefing match the tape?

7. CONTINUITY. When prior briefings exist, did this one surface anything that confirmed/invalidated a prior call? (yesterdays_call covers this most directly — score that block's quality here.)

8. BASIS PULSE DIRECTIONAL. Does basis use directional language ("tightening", "firming", "widening") rather than fabricated cents-over/under levels? On weekends/holidays, basis can be empty — score N/A as 10.

9. VOICE — THE BIGGEST ONE. Does it sound like a working ag operator (imperative, embedded thesis, vocabulary like "the funds got lost", "basis is talking", "the chart's bluffing") or does it read like a Bloomberg/Reuters wire summary? Wire-neutral prose scores BELOW 5 here. This rule has the lowest tolerance for drift.

10. THE FORWARD TEST. Would a working farmer forward this LEAD with one line of context to another farmer? If the lead is forgettable, score below 6. If it's the kind of line a producer would screenshot and text to a buddy, score 9-10.

11. THREAD COHERENCE (Tue-Fri only, score N/A=10 on Mon and weekends). Did today's lead materially advance Monday's weekly_thread.question? Mere rehash without new evidence scores below 5. Friday must resolve, not summarize.

12. SPREAD QUALITY. Is the spread_to_watch genuinely meaningful — capturing tension the headline price doesn't show — or filler? On weekends/holidays, score N/A as 10.

13. YESTERDAY'S CALL HONESTY. If outcome is "played_out", is the assessment actually accurate or self-serving? If outcome is "didnt", is the briefing honest about the miss? Score "played_out" calls that didn't actually play out as 1-3.

══ OUTPUT ══

Return ONLY valid JSON in this exact shape, no markdown:

{
  "scores": {
    "rule_1_lead_so_what": 0,
    "rule_2_conviction_earned": 0,
    "rule_3_tmyk_today": 0,
    "rule_4_watch_conditional": 0,
    "rule_5_bottom_lines_synthesize": 0,
    "rule_6_quiet_days_quiet": 0,
    "rule_7_continuity": 0,
    "rule_8_basis_directional": 0,
    "rule_9_voice": 0,
    "rule_10_forward_test": 0,
    "rule_11_thread_coherence": 0,
    "rule_12_spread_quality": 0,
    "rule_13_yc_honesty": 0
  },
  "weakest_rule": "rule_X_xxx",
  "weakest_target": "lead | section_index_N | basis | yesterdays_call | spread_to_watch | weekly_thread | tmyk",
  "rewrite_needed": true | false,
  "reasoning": "1-3 sentences explaining which rules failed and why.",
  "rewritten_content": null | { ... see below ... }
}

REWRITE FORMAT — only include when rewrite_needed is true:

If weakest_target is "lead": rewritten_content = {"lead": "new lead text"}
If weakest_target is "section_index_N": rewritten_content = {"section_index": N, "section": {...full section object with title/icon/body/bottom_line/conviction_level/etc...}}
If weakest_target is "basis": rewritten_content = {"basis": {"headline": "...", "body": "..."}}
If weakest_target is "yesterdays_call": rewritten_content = {"yesterdays_call": {"summary": "...", "outcome": "played_out|didnt|pending", "note": "..."}}
If weakest_target is "spread_to_watch": rewritten_content = {"spread_to_watch": {"label": "...", "level": "...", "commentary": "..."}}
If weakest_target is "weekly_thread": rewritten_content = {"weekly_thread": {"question": "...", "day": N, "status_text": "..."}}
If weakest_target is "tmyk": rewritten_content = {"the_more_you_know": {"title": "...", "body": "..."}}

REWRITE STANDARD — when you rewrite, the new content must:
- Hit the rule that was failing.
- Use the AGSIST voice. Imperative, embedded thesis, operator vocabulary. NO wire-service neutral.
- Cite only prices, levels, and conditions present in the original briefing's data — do NOT invent new prices.
- Keep length comparable to the original.
- Pass the Forward Test if the rewrite is the lead.

REWRITE THRESHOLD: rewrite_needed = true only if 2+ rules score BELOW the threshold (default 7) OR if rule 9 (voice) alone scores below 5 OR if rule 10 (forward test) alone scores below 5. Voice and forward test failures are individually disqualifying because they are the unmissable-vs-forgettable axis.

NO em dashes (U+2014) or en dashes (U+2013) in any rewritten content.
"""


def critique_briefing(briefing, threshold=7):
    """Send the full briefing to Claude as editor. Return scores + rewrite payload."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[error] ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    # Compose a compact representation of the briefing for the editor
    sections_compact = []
    for i, sec in enumerate(briefing.get("sections", [])):
        sections_compact.append({
            "index": i,
            "title": sec.get("title", ""),
            "icon": sec.get("icon", ""),
            "body": sec.get("body", ""),
            "bottom_line": sec.get("bottom_line", ""),
            "conviction_level": sec.get("conviction_level", ""),
            "overnight_surprise": sec.get("overnight_surprise", False),
            "farmer_action": sec.get("farmer_action", ""),
        })

    review_payload = {
        "date": briefing.get("date", ""),
        "headline": briefing.get("headline", ""),
        "subheadline": briefing.get("subheadline", ""),
        "lead": briefing.get("lead", ""),
        "one_number": briefing.get("one_number", {}),
        "yesterdays_call": briefing.get("yesterdays_call", {}),
        "sections": sections_compact,
        "spread_to_watch": briefing.get("spread_to_watch", {}),
        "basis": briefing.get("basis", {}),
        "weekly_thread": briefing.get("weekly_thread", {}),
        "the_more_you_know": briefing.get("the_more_you_know", {}),
        "watch_list": briefing.get("watch_list", []),
        "meta": briefing.get("meta", {}),
        "market_closed": briefing.get("market_closed", False),
        "surprise_count": briefing.get("surprise_count", 0),
        "locked_prices": briefing.get("locked_prices", {}),
    }

    user_message = f"""Score this AGSIST Daily draft against the 13 rules. Be honest. The threshold for rewrite is {threshold}.

DRAFT:
{json.dumps(review_payload, indent=2, ensure_ascii=False)}

Respond with ONLY the JSON output. No preamble, no markdown."""

    payload = {
        "model": MODEL,
        "max_tokens": 4000,
        "system": CRITIC_SYSTEM,
        "messages": [{"role": "user", "content": user_message}],
    }
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    result = http_post_json(ANTHROPIC_API, payload, headers, timeout=90)
    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text":
            text += block["text"]
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    if text.startswith("json"):
        text = text[4:].strip()
    return json.loads(text)


def apply_rewrite(briefing, critique):
    """Apply rewritten_content to the briefing. Returns (modified_briefing, applied_target)."""
    target = critique.get("weakest_target", "")
    rewritten = critique.get("rewritten_content") or {}

    if target == "lead" and rewritten.get("lead"):
        briefing["lead"] = rewritten["lead"]
        return briefing, "lead"

    if target.startswith("section_index_") and rewritten.get("section"):
        try:
            idx = int(target.replace("section_index_", ""))
        except ValueError:
            idx = rewritten.get("section_index", -1)
        if 0 <= idx < len(briefing.get("sections", [])):
            briefing["sections"][idx] = rewritten["section"]
            return briefing, f"section[{idx}]"

    for key in ("basis", "yesterdays_call", "spread_to_watch", "weekly_thread"):
        if target == key and rewritten.get(key):
            briefing[key] = rewritten[key]
            return briefing, key

    if target == "tmyk" and rewritten.get("the_more_you_know"):
        briefing["the_more_you_know"] = rewritten["the_more_you_know"]
        return briefing, "the_more_you_know"

    return briefing, None


def re_archive(briefing):
    """Re-render archive HTML and re-save daily.json after a rewrite."""
    try:
        from generate_daily import save_archive
    except ImportError as e:
        print(f"  [warn] could not import generate_daily.save_archive: {e}", file=sys.stderr)
        print(f"  [warn] daily.json will be updated but archive HTML will not be re-rendered.", file=sys.stderr)
        return False
    save_archive(briefing)
    return True


def format_scores(scores):
    """Pretty-print scores for the GitHub Actions log."""
    lines = []
    for rule, score in scores.items():
        bar = "█" * int(score) + "░" * (10 - int(score))
        flag = "  " if score >= 7 else " ⚠"
        lines.append(f"  {rule:<32} {bar} {score}/10{flag}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="AGSIST Daily critic pass")
    parser.add_argument("--dry-run", action="store_true", help="Score only, don't rewrite")
    parser.add_argument("--threshold", type=int, default=7, help="Min score before rewrite (default 7)")
    parser.add_argument("--max-rewrites", type=int, default=1, help="Max passes per run (default 1)")
    args = parser.parse_args()

    print("=== AGSIST Daily Critic Pass v1.0 ===")
    print(f"  Time: {datetime.now().isoformat()}")
    print(f"  Threshold: {args.threshold}/10")
    print(f"  Mode: {'DRY RUN' if args.dry_run else 'REWRITE ENABLED'}")

    if not DAILY_PATH.exists():
        print(f"[error] {DAILY_PATH} not found. Run generate_daily.py first.", file=sys.stderr)
        sys.exit(1)

    with open(DAILY_PATH) as f:
        briefing = json.load(f)

    print(f"  Briefing: {briefing.get('headline', '?')[:60]}...")
    print(f"  Issue: #{briefing.get('issue_number', '?')}")

    rewrite_log = []
    for pass_num in range(1, args.max_rewrites + 1):
        print(f"\n--- Critic pass {pass_num}/{args.max_rewrites} ---")
        critique = critique_briefing(briefing, threshold=args.threshold)

        scores = critique.get("scores", {})
        if scores:
            print("Scores:")
            print(format_scores(scores))

        avg = sum(scores.values()) / max(len(scores), 1)
        print(f"  Average: {avg:.1f}/10")

        weakest_rule = critique.get("weakest_rule", "?")
        print(f"  Weakest rule: {weakest_rule}")

        if critique.get("reasoning"):
            print(f"  Reasoning: {critique['reasoning']}")

        if not critique.get("rewrite_needed"):
            print("  ✓ No rewrite needed. Briefing passes.")
            break

        if args.dry_run:
            print(f"  [DRY RUN] Would rewrite: {critique.get('weakest_target', '?')}")
            break

        target = critique.get("weakest_target", "?")
        print(f"  Rewriting: {target}")
        briefing, applied = apply_rewrite(briefing, critique)
        if applied:
            print(f"  ✓ Applied rewrite to {applied}")
            rewrite_log.append({"pass": pass_num, "target": applied,
                               "rule": weakest_rule, "scores_before": dict(scores)})
        else:
            print(f"  [warn] Rewrite payload missing or invalid for target {target!r}; stopping.")
            break

    # Persist critic metadata on the briefing
    briefing["critic_pass"] = {
        "version": "1.0",
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "threshold": args.threshold,
        "final_scores": critique.get("scores", {}) if 'critique' in dir() else {},
        "rewrites_applied": rewrite_log,
        "dry_run": args.dry_run,
    }

    # Save back, re-archive if anything was rewritten
    with open(DAILY_PATH, "w") as f:
        json.dump(briefing, f, indent=2, ensure_ascii=False)
    print(f"\n  Wrote critic metadata to {DAILY_PATH}")

    if rewrite_log and not args.dry_run:
        print("  Re-rendering archive HTML with rewrites...")
        if re_archive(briefing):
            print("  ✓ Archive re-rendered.")
        else:
            print("  ⚠ Archive re-render failed; daily.json is updated but archive HTML may be stale.")

    print("=== Critic pass complete ===")


if __name__ == "__main__":
    main()
