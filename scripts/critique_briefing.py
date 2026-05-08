#!/usr/bin/env python3
"""
AGSIST Daily — Critic Pass (v1.2)
═══════════════════════════════════════════════════════════════════
Runs as the second step in the morning cron, after generate_daily.py.

Reads the just-generated data/daily.json. Sends the briefing back to
Claude as an editor. The editor scores 1-10 on each of the 17 IMPACT
RULES plus the Forward Test and the Voice Test. If 2+ rules score
below 7, the editor rewrites the weakest section (or lead, or basis,
or yesterdays_call, or weekly_thread.status_text) and the result is
re-saved + re-archived.

This is the quality gate that keeps the rules from drifting after
the first three weeks. Without it, the editorial spine softens.

v1.2 changes (2026-05-08): added 4 new rules covering the failure modes
that surfaced during the week of 2026-05-04:
  - Rule 14: Math/level coherence (Monday's $253-vs-$252 contradiction)
  - Rule 15: One-number label/value coherence (Tuesday's "live cattle
    decline" label paired with feeder cattle's 1.4% number)
  - Rule 16: Markdown not HTML (catches <strong> in body fields, paired
    with the v4.5.0 generator-side sanitize_html_tags pass)
  - Rule 17: Macro event grounding (catches week-long "Iran crisis"
    references with no anchoring context)

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
    """v1.1 (Phase 2 C5): retry with exponential backoff on transient
    failures. 429 (rate-limited) and 5xx are retryable. 4xx errors are
    surfaced immediately (auth/format issues won't fix themselves)."""
    import time as _time
    MAX_RETRIES = 3
    BACKOFF_SECONDS = [4, 12, 30]
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            if requests:
                r = requests.post(url, json=payload, headers=headers, timeout=timeout)
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    raise requests.exceptions.HTTPError(f"retryable HTTP {r.status_code}")
                r.raise_for_status()
                return r.json()
            data_bytes = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            last_err = e
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_SECONDS[attempt]
                print(f"  [warn] critic API call failed ({e}); "
                      f"retrying in {wait}s (attempt {attempt + 1}/{MAX_RETRIES})",
                      file=sys.stderr)
                _time.sleep(wait)
    raise last_err if last_err else RuntimeError("critic API call failed")


CRITIC_SYSTEM = """You are the editor of AGSIST Daily, a morning agricultural intelligence briefing read every weekday by US grain and livestock producers. You are reviewing a draft before it ships at 6 AM CT.

Your job is honest, calibrated scoring against the AGSIST editorial standard. You are NOT here to be encouraging. You are here to catch drift before subscribers see it.

══ THE 17 RULES YOU SCORE 1-10 ══

1. LEAD DELIVERS A "SO WHAT". Specific price + synthesizing observation. Not a wire-service recap.

2. CONVICTION EARNED. "Medium" labels must justify themselves. Default-to-low on quiet days is GOOD calibration.

3. TMYK TIES TO TODAY'S DATA. Opens with a hook tied to a number from today's briefing. Generic ag-history filler scores low.

4. WATCH LIST CONDITIONAL. At least HALF of items must include a specific level, threshold, or trigger. Calendar-only entries are weakest.

5. BOTTOM LINES SYNTHESIZE. Add information beyond the section title. If the bottom line is restating the section title, score it low.

6. QUIET DAYS QUIET. Manufactured drama on a flat day is a serious failure. Did the briefing match the tape?

7. CONTINUITY. When prior briefings exist, did this one surface anything that confirmed/invalidated a prior call? (yesterdays_call covers this most directly — score that block's quality here.)

8. BASIS PULSE DIRECTIONAL. Does basis use directional language ("tightening", "firming", "widening") rather than fabricated cents-over/under levels? On weekends/holidays, basis can be empty — score N/A as 10.

9. VOICE — THE BIGGEST ONE. Does it sound like a working ag operator (imperative, embedded thesis, vocabulary like "the funds got lost", "basis is talking", "the chart's bluffing") or does it read like a Bloomberg/Reuters wire summary? Wire-neutral prose scores BELOW 5 here. This rule has the lowest tolerance for drift.

ADDITIONAL VOICE FAILURES (auto score below 5 if any present):
  - "binary" / "binary level" / "binary week" / "binary support" — trader-tech jargon
  - "referendum on" — wire-blog cliche
  - "categorical" / "categorically" — press-release register
  - "decisively below" / "decisively above" / "decisively through" — risks the math contradiction in Rule 14

10. THE FORWARD TEST. Would a working farmer forward this LEAD with one line of context to another farmer? If the lead is forgettable, score below 6. If it's the kind of line a producer would screenshot and text to a buddy, score 9-10.

11. THREAD COHERENCE (Tue-Fri only, score N/A=10 on Mon and weekends). Did today's lead materially advance Monday's weekly_thread.question? Mere rehash without new evidence scores below 5. Friday must resolve, not summarize.

12. SPREAD QUALITY. Is the spread_to_watch genuinely meaningful — capturing tension the headline price doesn't show — or filler? On weekends/holidays, score N/A as 10.

13. YESTERDAY'S CALL HONESTY. If outcome is "played_out", is the assessment actually accurate or self-serving? If outcome is "didnt", is the briefing honest about the miss? Score "played_out" calls that didn't actually play out as 1-3.

14. MATH/LEVEL COHERENCE — INDIVIDUALLY DISQUALIFYING. Cross-check every "broke $X" / "below $X" / "under $X" / "above $X" / "held $X" claim against the locked_prices dict. The locked close MUST be on the breaking side of the level cited.
  Example failure: lead says "Cattle decisively below the $252 floor" but locked_prices.live_cattle = 253.00. That is a contradiction. Score 1.
  Example failure: section claims "wheat reclaimed $6.20" but locked_prices.wheat = 6.13. Score 1.
  Example pass: "Cattle broke $250" with locked_prices.live_cattle = 250.05 is editorially fine (5-cent slack on a round-number level). Score 8-10.
  This rule is FACTUAL not stylistic. Any contradiction = score below 5 = forced rewrite.

15. ONE NUMBER LABEL/VALUE COHERENCE. The one_number.value and one_number.unit must describe the SAME thing. If value=1.4%, unit must say what 1.4% IS, not a different commodity, not a different metric.
  Example failure: value="1.4%", unit="live cattle decline" but the context paragraph describes feeders dropping 1.4%. Score 1.
  Example pass: value="$795 million", unit="Brazilian beef exports to US in Q1". Score 9.
  Read value + unit aloud. Does it parse as a single coherent fact?

16. MARKDOWN NOT HTML — INDIVIDUALLY DISQUALIFYING. Body fields (lead, section.body, basis.body, takeaway, etc.) must use **markdown** for emphasis, NEVER literal <strong>...</strong> or <em>...</em> HTML tags. The frontend has defensive markdown-aware rendering, but storing HTML in JSON dirties the source of truth and breaks downstream consumers (email pipeline, RSS, AI crawlers).
  If you find <strong> or <em> anywhere in body fields, score 1. The generator's sanitize_html_tags pass should have caught these; if any survived, the rewrite must use **markdown**.

17. MACRO EVENT ANCHORING. The first time a briefing in a week references an ongoing geopolitical or macro event (Iran tensions, Hormuz disruption, election cycle, Fed pivot, trade war, etc.), it must include a one-clause anchor that establishes what the event is and roughly when it began. Subsequent references in the same week can use shorthand.
  Example failure: lead says "...as the Iran crisis premium evaporated" with no prior context this week and no in-text anchor. The reader who hits this briefing first has no idea what Iran crisis. Score 3.
  Example pass: "...as Iran-Iraq tensions over the Strait of Hormuz, ongoing since March, eased on diplomatic progress." Score 9.
  Score 10 if no macro events referenced.

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
    "rule_13_yc_honesty": 0,
    "rule_14_level_coherence": 0,
    "rule_15_one_number_coherence": 0,
    "rule_16_markdown_not_html": 0,
    "rule_17_macro_anchoring": 0
  },
  "weakest_rule": "rule_X_xxx",
  "weakest_target": "lead | section_index_N | basis | yesterdays_call | spread_to_watch | weekly_thread | tmyk | one_number",
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
If weakest_target is "one_number": rewritten_content = {"one_number": {"value": "...", "unit": "...", "context": "..."}}

REWRITE STANDARD — when you rewrite, the new content must:
- Hit the rule that was failing.
- Use the AGSIST voice. Imperative, embedded thesis, operator vocabulary. NO wire-service neutral.
- Cite only prices, levels, and conditions present in the original briefing's data — do NOT invent new prices.
- For Rule 14 rewrites: use locked_prices values directly. If close > level being claimed broken, soften "broke" to "tested" or "right back to". If close < level being claimed held, soften "held above" to "tested" or "fell through".
- For Rule 16 rewrites: replace any literal <strong>...</strong> with **...** and any <em>...</em> with *...*.
- Keep length comparable to the original.
- Pass the Forward Test if the rewrite is the lead.
- Use **markdown** for emphasis, NEVER <strong> HTML tags.

REWRITE THRESHOLD: rewrite_needed = true if ANY of:
  - 2+ rules score BELOW the threshold (default 7)
  - Rule 9 (voice) alone scores below 5
  - Rule 10 (forward test) alone scores below 5
  - Rule 14 (level coherence) alone scores below 7 — factual contradictions are individually disqualifying
  - Rule 16 (markdown not HTML) alone scores below 7 — JSON cleanliness is individually disqualifying

Voice, forward test, level coherence, and markdown-not-HTML failures are individually disqualifying because they each have a different category of cost: voice is the brand, forward test is engagement, level coherence is trust, markdown-not-HTML is downstream pipeline integrity.

NO em dashes (U+2014) or en dashes (U+2013) in any rewritten content.
NO <strong> or <em> HTML tags in any rewritten content - use **markdown** instead.
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

    user_message = f"""Score this AGSIST Daily draft against the 17 rules. Be honest. The threshold for rewrite is {threshold}.

The locked_prices field at the bottom of the draft is the canonical close prices for today. When checking Rule 14 (level coherence), match each "broke $X" / "below $X" / "above $X" claim against locked_prices and flag any contradiction.

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

    # v1.2: one_number rewrite target for Rule 15 (label/value coherence)
    if target == "one_number" and rewritten.get("one_number"):
        briefing["one_number"] = rewritten["one_number"]
        return briefing, "one_number"

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

    print("=== AGSIST Daily Critic Pass v1.2 ===")
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
        "version": "1.2",
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
