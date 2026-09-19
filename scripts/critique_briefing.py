#!/usr/bin/env python3
"""
AGSIST Daily — Critic Pass (v2.0, the cut)
═══════════════════════════════════════════════════════════════════
Runs as the second step in the morning cron, after generate_daily.py.

v2.0 (2026-09-13): scores the 16 rules of the cut briefing (~400 words,
450 hard). Two rewrite targets that did not exist before, because without
them the critic could not ask for the one thing the cut needs:
  drop_section_N  remove a whole section (weakest material goes, not mush)
  trim            shorten named fields; every replacement must be SHORTER
                  than what it replaces or it is refused
Plus `action` (the one mandatory thresholded action). yesterdays_call
rewrites touch the note only; the call line is printed from the record.
After any rewrite, briefing_cut.enforce_budget() runs, so the critic cannot
push the briefing back over the ceiling it was asked to enforce. The review
payload carries measured word counts per field, so the editor scores Rule 8
from numbers, not by counting.

Reads the just-generated data/daily.json. Sends the briefing back to
Claude as an editor. The editor scores 1-10 on each of the 17 IMPACT
RULES plus the Forward Test and the Voice Test. v1.3 (2026-05-18)
extends Rule 9 voice-failure auto-fail list with CNBC drama vocabulary
(explode, crater, surge, soar, plunge, slash, exodus, ignite, etc.)
to match generator v4.6.0's editorial-hardening upgrade. If 2+ rules score
below 7, the editor rewrites the weakest section (or lead,
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
# Matches the generator: BRIEFING_MODEL, else claude-sonnet-5, with one fall
# back to claude-sonnet-4-6 if the API does not know the model.
MODEL = os.environ.get("BRIEFING_MODEL", "").strip() or "claude-sonnet-5"
FALLBACK_MODEL = "claude-sonnet-4-6"


def _refused_model(e):
    """(status, body) if an exception is the API saying it does not know the
    model -- a 404, or a 400 naming "model:" -- else None. Reads both a
    requests error (e.response) and a urllib one (e.code, e.read())."""
    resp = getattr(e, "response", None)
    sc = getattr(resp, "status_code", None) if resp is not None else getattr(e, "code", None)
    body = ""
    try:
        body = (getattr(resp, "text", "") if resp is not None else e.read().decode("utf-8", "replace")) or ""
    except Exception:
        pass
    if sc == 404 or (sc == 400 and "model:" in body.lower()):
        return sc, body[:200]
    return None

# Make the generator importable so we can re-archive after rewrite
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import briefing_cut   # noqa: E402  ONE definition of the word budget


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

The briefing is SHORT by design: about 400 words, 450 is a hard ceiling. The reader who pays for this said he barely reads it because it was too long. Length is a product rule, not a style note.

══ THE 16 RULES YOU SCORE 1-10 ══

1. LEAD DELIVERS A "SO WHAT". Specific price + synthesizing observation. Not a wire-service recap.

2. CONVICTION EARNED. "Medium" labels must justify themselves. Default-to-low on quiet days is GOOD calibration.

3. THE LEDE DOES NOT DEFER. The LAST sentence of the lead must state a consequence that is already true (what today's close did to a bushel, a load, a margin, a decision). If it points forward instead ("Tuesday's print decides", "the question is whether", "this week tells you", "will set", "holds the answer", "watch Thursday") score below 5 and name `lead` as the target. The forward pointer belongs in the watch list.

4. WATCH LIST: 3 ITEMS, 20 WORDS EACH, CONDITIONAL. At least two of the three include a specific level, threshold, or trigger. More than 3 items or an item over 20 words scores below 7 with target `trim`.

5. SO WHAT SYNTHESIZES. Each section's so_what (15 words max) adds information beyond the section title. A restatement of the title scores low with target `section_index_N`.

6. QUIET DAYS QUIET. Manufactured drama on a flat day is a serious failure. Did the briefing match the tape?

7. YESTERDAY'S CALL HONESTY. `outcome` is computed deterministically from the closing prices by the grader and is GROUND TRUTH — you may NOT change it. The call itself is printed from the record as `call_line`; you may not change that either. You judge the NOTE only: (a) it must be about the instrument in `computed.instrument`; (b) it must be honest about `computed.outcome` (a "didnt" note owns the miss; a "played_out" note is accurate, not self-serving); (c) it is ONE sentence, 25 words max, and does not restate the call. A note about a different market or a miss written as a win scores 1-3 with target `yesterdays_call`.

8. THE WORD BUDGET — THE CUT. The draft comes with MEASURED word counts per field (`word_counts`) and the total. Caps: lead 55; section body 55; so_what 15; one_number.context 30; action 25; yesterdays_call.note 25; outside_the_pit body 30; watch item 20; sections 2-3; outside_the_pit exactly 1; watch_list exactly 3. Score 10 when the total is at or under 400 and every field is inside its cap. Any field over its cap scores below 7 and names `trim` as the target, listing the fields. A fourth section scores below 7 and names `drop_section_N` for the weakest one. A total over 450 scores below 5. The rewrite CUTS the weakest material; it never compresses good sentences into mush.

9. VOICE — THE BIGGEST ONE. Does it sound like a working ag operator (imperative, embedded thesis, vocabulary like "the funds got lost", "basis is talking", "the chart's bluffing") or does it read like a Bloomberg/Reuters wire summary? Wire-neutral prose scores BELOW 5 here. This rule has the lowest tolerance for drift.

ADDITIONAL VOICE FAILURES (auto score below 5 if any present):
  - "binary" / "binary level" / "binary week" / "binary support" — trader-tech jargon
  - "referendum on" — wire-blog cliche
  - "categorical" / "categorically" — press-release register
  - "decisively below" / "decisively above" / "decisively through" — risks the math contradiction in Rule 13
  - "exploded" / "explode" / "explosion" — CNBC drama verb
  - "crater" / "cratered" / "cratering" — same
  - "crashed" / "crash" used as verb form — same; "the crash of [year]" as noun is permissible
  - "surge" / "surged" / "surging" — wire-service drama
  - "soared" / "soaring" / "rocketed" / "skyrocketed" — same
  - "plunged" / "plunging" / "plummeted" — same
  - "slashed" used as a price/volume verb — wire register
  - "exodus" / "fleeing" / "panic" — drama, not analysis
  - "ignited" / "caught fire" / "torched" — drama
  - "bloodbath" / "carnage" / "meltdown" / "rout" — never appropriate
  - "vaulted" / "leaped" (in price context) — drama

CNBC DRAMA VERB PRINCIPLE: AGSIST is a Wisconsin crop insurance guy talking to working farmers. Big moves get described by size and rarity ("biggest day in three weeks"), not by drama verbs. Any drama verb found in lead, sections, action, or one_number context = auto Rule 9 below 5 = forced rewrite.

10. THE FORWARD TEST. Would a working farmer forward this LEAD with one line of context to another farmer? If the lead is forgettable, score below 6. If it's the kind of line a producer would screenshot and text to a buddy, score 9-10.

11. ONE ACTION, THRESHOLDED. `action` is mandatory on a weekday: one sentence, 25 words max, naming an instrument, a level in the locked-price units, and what a producer does at that level. Missing, a mood ("stay cautious"), or no number: score 1-3 with target `action`. A level that contradicts locked_prices (see Rule 13) also fails here.

12. ONE FACT, ONE HOME. Scan the whole briefing for the same stat, story, or forecast told more than once. A pointer of six words or fewer is fine; a re-explanation is not. Any fact substantively explained twice scores below 5 and the rewrite deletes the weaker telling (`trim`, or `drop_section_N` when a whole section is the duplicate). Also disqualifying: internal field names in reader prose ("the one_number today") and impossible stats ("102% of the 52-week range").

13. MATH/LEVEL COHERENCE — INDIVIDUALLY DISQUALIFYING. Cross-check every "broke $X" / "below $X" / "under $X" / "above $X" / "held $X" claim against the locked_prices dict. The locked close MUST be on the breaking side of the level cited.
  Example failure: lead says "Cattle decisively below the $252 floor" but locked_prices.live_cattle = 253.00. That is a contradiction. Score 1.
  Example failure: section claims "wheat reclaimed $6.20" but locked_prices.wheat = 6.13. Score 1.
  Example pass: "Cattle broke $250" with locked_prices.live_cattle = 250.05 is editorially fine (5-cent slack on a round-number level). Score 8-10.
  This rule is FACTUAL not stylistic. Any contradiction = score below 5 = forced rewrite.

14. ONE NUMBER LABEL/VALUE COHERENCE. The one_number.value and one_number.unit must describe the SAME thing. If value=1.4%, unit must say what 1.4% IS, not a different commodity, not a different metric.
  Example failure: value="1.4%", unit="live cattle decline" but the context paragraph describes feeders dropping 1.4%. Score 1.
  Example pass: value="$795 million", unit="Brazilian beef exports to US in Q1". Score 9.

15. MARKDOWN NOT HTML — INDIVIDUALLY DISQUALIFYING. Body fields (lead, section.body, action, etc.) must use **markdown** for emphasis, NEVER literal <strong>...</strong> or <em>...</em> HTML tags. If you find <strong> or <em> anywhere in body fields, score 1.

16. MACRO EVENT ANCHORING. The first time a briefing in a week references an ongoing geopolitical or macro event (Iran tensions, Hormuz disruption, election cycle, Fed pivot, trade war, etc.), it must include a one-clause anchor that establishes what the event is and roughly when it began. Score 10 if no macro events referenced.

══ OUTPUT ══

Return ONLY valid JSON in this exact shape, no markdown:

{
  "scores": {
    "rule_1_lead_so_what": 0,
    "rule_2_conviction_earned": 0,
    "rule_3_lede_no_deferral": 0,
    "rule_4_watch_conditional": 0,
    "rule_5_so_what_synthesizes": 0,
    "rule_6_quiet_days_quiet": 0,
    "rule_7_yc_honesty": 0,
    "rule_8_word_budget": 0,
    "rule_9_voice": 0,
    "rule_10_forward_test": 0,
    "rule_11_action_thresholded": 0,
    "rule_12_one_fact_one_home": 0,
    "rule_13_level_coherence": 0,
    "rule_14_one_number_coherence": 0,
    "rule_15_markdown_not_html": 0,
    "rule_16_macro_anchoring": 0
  },
  "weakest_rule": "rule_X_xxx",
  "weakest_target": "lead | section_index_N | drop_section_N | trim | yesterdays_call | one_number | action",
  "rewrite_needed": true | false,
  "reasoning": "1-3 sentences explaining which rules failed and why.",
  "rewritten_content": null | { ... see below ... }
}

REWRITE FORMAT — only include when rewrite_needed is true:

If weakest_target is "lead": rewritten_content = {"lead": "new lead text"}  (55 words max; last sentence states a consequence already true)
If weakest_target is "section_index_N": rewritten_content = {"section_index": N, "section": {"title": "...", "body": "- ...\\n- ...", "so_what": "...", "conviction_level": "...", "overnight_surprise": false}}
If weakest_target is "drop_section_N": rewritten_content = {"drop_section": N}  — the section is removed; nothing else changes. Never drop below 2 sections.
If weakest_target is "trim": rewritten_content = {"trim": {"lead": "...", "sections": [{"index": N, "body": "...", "so_what": "..."}], "one_number_context": "...", "action": "...", "yesterdays_call_note": "...", "outside_the_pit_body": "...", "watch_list": [{"time": "...", "desc": "..."}, ...]}}  — include ONLY the fields you are shortening. Every replacement MUST be shorter than the original or it is refused. Cut sentences and bullets, do not compress them.
If weakest_target is "yesterdays_call": rewritten_content = {"yesterdays_call": {"note": "..."}}  — note only. outcome and call_line are read-only.
If weakest_target is "one_number": rewritten_content = {"one_number": {"value": "...", "unit": "...", "context": "..."}}
If weakest_target is "action": rewritten_content = {"action": "..."}  (25 words max; instrument + level + what to do)

REWRITE STANDARD — when you rewrite, the new content must:
- Hit the rule that was failing.
- Use the AGSIST voice. Imperative, embedded thesis, operator vocabulary. NO wire-service neutral.
- Cite only prices, levels, and conditions present in the original briefing's data — do NOT invent new prices.
- For Rule 13 rewrites: use locked_prices values directly. If close > level being claimed broken, soften "broke" to "tested" or "right back to". If close < level being claimed held, soften "held above" to "tested" or "fell through".
- For Rule 15 rewrites: replace any literal <strong>...</strong> with **...** and any <em>...</em> with *...*.
- Respect the caps in Rule 8: a rewrite that fixes voice but blows the budget is still a failure. A machine re-cuts after you; do not make it.
- Pass the Forward Test if the rewrite is the lead, and end the lead on a consequence already true (Rule 3).
- Use **markdown** for emphasis, NEVER <strong> HTML tags.

REWRITE THRESHOLD: rewrite_needed = true if ANY of:
  - 2+ rules score BELOW the threshold (default 7)
  - Rule 3 (lede deferral) alone scores below 5
  - Rule 8 (word budget) alone scores below 7 — length is a product rule
  - Rule 9 (voice) alone scores below 5
  - Rule 10 (forward test) alone scores below 5
  - Rule 11 (action) alone scores below 5 — a briefing without a thresholded action is not finished
  - Rule 13 (level coherence) alone scores below 7 — factual contradictions are individually disqualifying
  - Rule 15 (markdown not HTML) alone scores below 7 — JSON cleanliness is individually disqualifying

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
            "body": sec.get("body", ""),
            "so_what": sec.get("so_what", "") or sec.get("bottom_line", ""),
            "conviction_level": sec.get("conviction_level", ""),
            "overnight_surprise": sec.get("overnight_surprise", False),
        })

    # Measured, not eyeballed: the editor scores Rule 8 from these numbers.
    counts = briefing_cut.field_counts(briefing)
    review_payload = {
        "date": briefing.get("date", ""),
        "headline": briefing.get("headline", ""),
        "lead": briefing.get("lead", ""),
        "one_number": briefing.get("one_number", {}),
        "yesterdays_call": briefing.get("yesterdays_call", {}),
        "action": briefing.get("action", ""),
        "sections": sections_compact,
        "outside_the_pit": briefing.get("outside_the_pit", []),
        "watch_list": briefing.get("watch_list", []),
        "meta": briefing.get("meta", {}),
        "market_closed": briefing.get("market_closed", False),
        "surprise_count": briefing.get("surprise_count", 0),
        "locked_prices": briefing.get("locked_prices", {}),
        "word_counts": counts,
        "word_total": sum(counts.values()),
        "word_target": briefing_cut.TARGET_WORDS,
        "word_ceiling": briefing_cut.HARD_CEILING,
        "lede_defers": briefing_cut.lede_defers(briefing.get("lead", "")) or None,
    }

    user_message = f"""Score this AGSIST Daily draft against the 16 rules. Be honest. The threshold for rewrite is {threshold}.

The locked_prices field near the bottom of the draft is the canonical close prices for today. When checking Rule 13 (level coherence), match each "broke $X" / "below $X" / "above $X" claim against locked_prices and flag any contradiction. word_counts / word_total are MEASURED; use them for Rule 8 instead of counting. lede_defers, when not null, is the lead's last sentence and it points forward (Rule 3).

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

    try:
        result = http_post_json(ANTHROPIC_API, payload, headers, timeout=90)
    except Exception as e:
        _ref = _refused_model(e)
        if _ref and payload["model"] != FALLBACK_MODEL:
            print(f"::warning title=Critic model fallback::'{payload['model']}' refused "
                  f"(HTTP {_ref[0]}); the critic pass runs on {FALLBACK_MODEL}", flush=True)
            payload["model"] = FALLBACK_MODEL
            globals()["MODEL"] = FALLBACK_MODEL
            result = http_post_json(ANTHROPIC_API, payload, headers, timeout=90)
        else:
            raise
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


def _shorter(new, old):
    return isinstance(new, str) and new.strip() and briefing_cut.wc(new) < briefing_cut.wc(old or "")


def _normalize_section(sec):
    """A rewritten section may still say bottom_line; it means so_what. The
    retired per-section fields never come back through a rewrite."""
    if not isinstance(sec, dict):
        return sec
    if sec.get("bottom_line") and not sec.get("so_what"):
        sec["so_what"] = sec.pop("bottom_line")
    for k in briefing_cut.RETIRED_SECTION_FIELDS + ("farmer_action",):
        sec.pop(k, None)
    return sec


def apply_rewrite(briefing, critique):
    """Apply rewritten_content to the briefing. Returns (modified_briefing, applied_target).
    v2.0: drop_section_N, trim and action targets; yesterdays_call is note-only.
    Whatever was applied, briefing_cut.enforce_budget runs afterwards so a
    rewrite can never leave the briefing over the ceiling."""
    target = critique.get("weakest_target", "")
    rewritten = critique.get("rewritten_content") or {}
    applied = None

    if target == "lead" and rewritten.get("lead"):
        briefing["lead"] = rewritten["lead"]
        applied = "lead"

    elif target.startswith("section_index_") and rewritten.get("section"):
        try:
            idx = int(target.replace("section_index_", ""))
        except ValueError:
            idx = rewritten.get("section_index", -1)
        if 0 <= idx < len(briefing.get("sections", [])):
            briefing["sections"][idx] = _normalize_section(rewritten["section"])
            applied = f"section[{idx}]"

    elif target.startswith("drop_section_"):
        try:
            idx = int(target.replace("drop_section_", ""))
        except ValueError:
            idx = rewritten.get("drop_section", -1)
        secs = briefing.get("sections") or []
        if 0 <= idx < len(secs) and len(secs) > briefing_cut.MIN_SECTIONS:
            dropped = secs.pop(idx)
            briefing["sections"] = secs
            applied = f"drop_section[{idx}] {dropped.get('title', '')!r}"
        else:
            print(f"  [warn] drop_section_{idx} refused (sections={len(secs)}, min={briefing_cut.MIN_SECTIONS})")

    elif target == "trim" and isinstance(rewritten.get("trim"), dict):
        t = rewritten["trim"]
        done, refused = [], []

        def take(label, old, new, setter):
            if new is None:
                return
            if _shorter(new, old):
                setter(new); done.append(label)
            else:
                refused.append(f"{label} ({briefing_cut.wc(old)}w -> {briefing_cut.wc(new) if isinstance(new, str) else '?'}w)")

        take("lead", briefing.get("lead"), t.get("lead"), lambda v: briefing.__setitem__("lead", v))
        take("action", briefing.get("action"), t.get("action"), lambda v: briefing.__setitem__("action", v))
        on = briefing.get("one_number")
        if isinstance(on, dict):
            take("one_number.context", on.get("context"), t.get("one_number_context"), lambda v: on.__setitem__("context", v))
        yc = briefing.get("yesterdays_call")
        if isinstance(yc, dict):
            take("yesterdays_call.note", yc.get("note"), t.get("yesterdays_call_note"), lambda v: yc.__setitem__("note", v))
        otp = briefing.get("outside_the_pit") or []
        if otp and isinstance(otp[0], dict):
            take("outside_the_pit[0].body", otp[0].get("body"), t.get("outside_the_pit_body"), lambda v: otp[0].__setitem__("body", v))
        for item in (t.get("sections") or []):
            if not isinstance(item, dict):
                continue
            try:
                i = int(item.get("index"))
            except (TypeError, ValueError):
                continue
            secs = briefing.get("sections") or []
            if not (0 <= i < len(secs)):
                continue
            take(f"sections[{i}].body", secs[i].get("body"), item.get("body"), lambda v, s=secs[i]: s.__setitem__("body", v))
            take(f"sections[{i}].so_what", secs[i].get("so_what") or secs[i].get("bottom_line"), item.get("so_what"),
                 lambda v, s=secs[i]: (s.pop("bottom_line", None), s.__setitem__("so_what", v)))
        wl_new = t.get("watch_list")
        if isinstance(wl_new, list) and wl_new:
            old_wl = briefing.get("watch_list") or []
            old_words = sum(briefing_cut.wc(w.get("desc")) for w in old_wl if isinstance(w, dict))
            new_wl = [w for w in wl_new if isinstance(w, dict) and (w.get("desc") or "").strip()]
            new_words = sum(briefing_cut.wc(w.get("desc")) for w in new_wl)
            if new_wl and new_words < old_words and len(new_wl) <= len(old_wl):
                briefing["watch_list"] = new_wl; done.append("watch_list")
            else:
                refused.append(f"watch_list ({old_words}w -> {new_words}w)")
        if refused:
            print(f"  [warn] trim refused, not shorter: {', '.join(refused)}")
        if done:
            applied = "trim: " + ", ".join(done)

    # yesterdays_call: the critic may rewrite the NOTE and nothing else.
    # outcome, computed and call_line are owned by grade_calls.py — a price
    # function, not the model. (The 2026-06-26 send was blocked when a critic
    # relabeled 'didnt' -> 'played_out' and the gate re-graded it.)
    elif target == "yesterdays_call" and rewritten.get("yesterdays_call"):
        existing = briefing.get("yesterdays_call") or {}
        merged = dict(existing)
        v = rewritten["yesterdays_call"].get("note")
        if v is not None:
            merged["note"] = v
        merged.pop("summary", None)
        briefing["yesterdays_call"] = merged
        applied = "yesterdays_call.note"

    elif target == "one_number" and rewritten.get("one_number"):
        briefing["one_number"] = rewritten["one_number"]
        applied = "one_number"

    elif target == "action" and rewritten.get("action"):
        briefing["action"] = rewritten["action"]
        applied = "action"

    if applied:
        briefing, cut_log = briefing_cut.enforce_budget(briefing)
        for line in cut_log:
            print(f"  [cut] {line}")
        n = briefing_cut.word_count(briefing)
        print(f"  Word count after rewrite: {n} (ceiling {briefing_cut.HARD_CEILING})")
        if isinstance(briefing.get("meta"), dict):
            briefing["meta"]["word_count"] = n
    return briefing, applied


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

    print("=== AGSIST Daily Critic Pass v2.0 (the cut) ===")
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
        "version": "2.0",
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
