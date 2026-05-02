"""
AGSIST Daily — canonical schema + validator.

Single source of truth for daily.json field names. Both the generator
(writes) and the front-end renderer (reads) must agree on these names.

Run directly to validate: python scripts/daily_schema.py data/daily.json
Exit code 0 = valid, 1 = invalid (causes workflow to fail).

v4.0 update: knows about yesterdays_call, spread_to_watch, weekly_thread,
critic_pass. Validates outcome enum (played_out/didnt/pending) and weekly
thread day enum (1-5). All v3.x checks preserved unchanged.

v4.2 update (Phase 2): adds optional fields the_takeaway, subject_line,
named_week (top-level), and vs_yesterday (per-section). Schema slots are
ready before the prompt emits them — the renderer can read these as soon
as the generator starts producing them.
"""
import sys
import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Canonical field names — the only accepted names going forward.
# If a field is missing or renamed, validation fails and the workflow fails.
# ---------------------------------------------------------------------------

REQUIRED_TOP_LEVEL = [
    "headline",
    "subheadline",
    "lead",
    "sections",
    "date",
    "generated_at",
]

OPTIONAL_TOP_LEVEL = [
    "teaser",
    "one_number",          # {value, unit, context}
    "the_more_you_know",   # {title, body}
    "watch_list",          # [{time, desc}]
    "daily_quote",         # {text, attribution}
    "source_summary",
    "meta",
    "generator_version",
    "surprise_count",
    "surprises",
    "price_validation_clean",
    "market_closed",
    "market_status_reason",
    "prices",
    "chart_series",        # v3.6: {corn, soybeans, wheat} rolling arrays
    "locked_prices",       # v3.6: {corn, beans, wheat, ...} today's closes
    # v3.9
    "basis",               # {headline, body} — directional only, weekday-required
    "sponsor",             # {advertiser, headline, body, cta_text, cta_url, is_house_ad}
    "issue_number",        # int, archive count + 1
    # v4.0 (the unmissable upgrade)
    "yesterdays_call",     # {summary, outcome: played_out|didnt|pending, note}
    "spread_to_watch",     # {label, level, commentary}
    "weekly_thread",       # {question, day: 1-5, status_text}
    "critic_pass",         # {version, ran_at, threshold, final_scores, rewrites_applied, dry_run}
    # v4.2 (Phase 2)
    "the_takeaway",        # str: single-sentence "if you remember one thing"
    "subject_line",        # str: AI-suggested email subject for daily send
    "named_week",          # {title, started_at, theme} — Mon-Fri week-arc title
]

# Deprecated field names — if present, validation warns but does not fail.
# Remove the warning once the generator has been fully migrated.
DEPRECATED_ALIASES = {
    "quote": "daily_quote",
    "tmyk": "the_more_you_know",
    "the_number": "one_number",
    "number": "one_number",
}

SECTION_REQUIRED = ["title", "body"]
SECTION_OPTIONAL = [
    "icon",
    "bottom_line",
    "conviction_level",
    "overnight_surprise",
    "farmer_action",
    "vs_yesterday",        # v4.2 (Phase 2): per-section continuity marker
]

ONE_NUMBER_REQUIRED = ["value"]
ONE_NUMBER_OPTIONAL = ["unit", "context"]

TMYK_REQUIRED = ["title", "body"]

QUOTE_REQUIRED = ["text", "attribution"]

WATCH_ITEM_REQUIRED = ["desc"]  # time is optional

CHART_SERIES_KEYS = {"corn", "soybeans", "wheat"}

# v4.0 enums — strict values the generator and renderer agree on
YC_OUTCOMES = {"played_out", "didnt", "pending"}
WEEKLY_THREAD_DAYS = {1, 2, 3, 4, 5}  # Mon=1, Fri=5


def validate(data: dict) -> tuple[bool, list[str], list[str]]:
    """Return (is_valid, errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []

    # Top-level required fields
    for field in REQUIRED_TOP_LEVEL:
        if field not in data:
            errors.append(f"Missing required top-level field: {field}")
            continue
        v = data[field]
        # Also catch blank/whitespace-only strings — an empty headline or date
        # would otherwise silently pass and ship. Mirrors the section-level
        # check; list/dict fields get type-aware validation further down.
        if isinstance(v, str) and not v.strip():
            errors.append(f"Required top-level field '{field}' is empty")

    # Deprecated aliases — warn so we catch drift early
    for old, new in DEPRECATED_ALIASES.items():
        if old in data and new not in data:
            warnings.append(
                f"Deprecated field name '{old}' found — rename to '{new}'"
            )
        elif old in data and new in data:
            warnings.append(
                f"Both deprecated '{old}' and canonical '{new}' present — "
                f"drop '{old}'"
            )

    # sections array
    secs = data.get("sections")
    if not isinstance(secs, list):
        errors.append("'sections' must be a list")
    elif len(secs) < 1:
        errors.append("'sections' must contain at least one entry")
    else:
        for i, s in enumerate(secs):
            if not isinstance(s, dict):
                errors.append(f"sections[{i}] is not an object")
                continue
            for f in SECTION_REQUIRED:
                if f not in s or not s[f]:
                    errors.append(f"sections[{i}] missing '{f}'")

    # one_number (optional block, but if present must be valid)
    on = data.get("one_number")
    if on is not None:
        if not isinstance(on, dict):
            errors.append("'one_number' must be an object")
        else:
            for f in ONE_NUMBER_REQUIRED:
                if f not in on or on[f] in (None, ""):
                    errors.append(f"one_number.{f} is required when block present")

    # the_more_you_know
    tmyk = data.get("the_more_you_know")
    if tmyk is not None:
        if not isinstance(tmyk, dict):
            errors.append("'the_more_you_know' must be an object")
        else:
            for f in TMYK_REQUIRED:
                if f not in tmyk or not tmyk[f]:
                    errors.append(f"the_more_you_know.{f} is required when block present")

    # daily_quote
    q = data.get("daily_quote")
    if q is not None:
        if not isinstance(q, dict):
            errors.append("'daily_quote' must be an object")
        else:
            for f in QUOTE_REQUIRED:
                if f not in q or not q[f]:
                    errors.append(f"daily_quote.{f} is required when block present")
            # Fail-loud on filler attribution
            attr = (q.get("attribution") or "").strip().lower()
            if attr in ("unknown", "anonymous", "", "n/a"):
                errors.append(
                    f"daily_quote.attribution is a filler value ({q.get('attribution')!r}). "
                    "Pick from data/quote-pool.json — never synthesize."
                )

    # watch_list
    wl = data.get("watch_list")
    if wl is not None:
        if not isinstance(wl, list):
            errors.append("'watch_list' must be a list")
        else:
            for i, item in enumerate(wl):
                if not isinstance(item, dict):
                    errors.append(f"watch_list[{i}] is not an object")
                    continue
                for f in WATCH_ITEM_REQUIRED:
                    if f not in item or not item[f]:
                        errors.append(f"watch_list[{i}] missing '{f}'")

    # chart_series (optional — but if present, must be well-formed)
    cs = data.get("chart_series")
    if cs is not None:
        if not isinstance(cs, dict):
            errors.append("'chart_series' must be an object")
        else:
            unknown = set(cs.keys()) - CHART_SERIES_KEYS
            if unknown:
                warnings.append(
                    f"chart_series has unknown keys: {sorted(unknown)} "
                    f"(expected subset of {sorted(CHART_SERIES_KEYS)})"
                )
            for key, series in cs.items():
                if not isinstance(series, list):
                    errors.append(f"chart_series.{key} must be a list")
                    continue
                if len(series) < 2:
                    warnings.append(
                        f"chart_series.{key} has only {len(series)} point(s) — "
                        "sparkline will not render (needs 2+)"
                    )
                for j, v in enumerate(series):
                    if not isinstance(v, (int, float)):
                        errors.append(
                            f"chart_series.{key}[{j}] is not numeric ({v!r})"
                        )
                        break

    # locked_prices (optional, shape-only check — generator owns the contract)
    lp = data.get("locked_prices")
    if lp is not None and not isinstance(lp, dict):
        errors.append("'locked_prices' must be an object")

    # ─────────────────────────────────────────────────────────────────────
    # v3.9 + v4.0 BLOCKS — shape and enum validation
    # ─────────────────────────────────────────────────────────────────────

    # basis (v3.9) — directional language only, weekday-required, weekend-empty
    bs = data.get("basis")
    if bs is not None:
        if not isinstance(bs, dict):
            errors.append("'basis' must be an object")
        elif bs:
            h = (bs.get("headline") or "").strip()
            b = (bs.get("body") or "").strip()
            # Either both populated (weekday) or both empty (weekend/holiday).
            # One-of asymmetry is a generator bug.
            if (h and not b) or (b and not h):
                warnings.append(
                    f"basis has only one of headline/body set — "
                    f"both should be populated (weekday) or both empty (weekend)"
                )

    # yesterdays_call (v4.0) — outcome must be valid enum when summary is set
    yc = data.get("yesterdays_call")
    if yc is not None:
        if not isinstance(yc, dict):
            errors.append("'yesterdays_call' must be an object")
        elif yc:
            summary = (yc.get("summary") or "").strip()
            if summary:
                outcome = (yc.get("outcome") or "").strip().lower()
                if outcome not in YC_OUTCOMES:
                    errors.append(
                        f"yesterdays_call.outcome must be one of "
                        f"{sorted(YC_OUTCOMES)} when summary is set "
                        f"(got {yc.get('outcome')!r})"
                    )

    # spread_to_watch (v4.0) — coherent shape
    sp = data.get("spread_to_watch")
    if sp is not None:
        if not isinstance(sp, dict):
            errors.append("'spread_to_watch' must be an object")
        elif sp:
            label = (sp.get("label") or "").strip()
            commentary = (sp.get("commentary") or "").strip()
            # Both should be present together, or both omitted (weekend/holiday).
            # One without the other suggests the model only half-filled the block.
            if label and not commentary:
                warnings.append(
                    "spread_to_watch.label set but commentary is empty"
                )
            if commentary and not label:
                warnings.append(
                    "spread_to_watch.commentary set but label is empty"
                )

    # weekly_thread (v4.0) — day must be int 1-5 when question is set
    wt = data.get("weekly_thread")
    if wt is not None:
        if not isinstance(wt, dict):
            errors.append("'weekly_thread' must be an object")
        elif wt:
            question = (wt.get("question") or "").strip()
            if question:
                day = wt.get("day")
                if not isinstance(day, int) or day not in WEEKLY_THREAD_DAYS:
                    errors.append(
                        f"weekly_thread.day must be an integer in "
                        f"{sorted(WEEKLY_THREAD_DAYS)} when question is set "
                        f"(got {day!r})"
                    )
                if not (wt.get("status_text") or "").strip():
                    warnings.append(
                        "weekly_thread.question set but status_text is empty — "
                        "Mon should set up, Tue-Thu progress, Fri resolve"
                    )

    # critic_pass (v4.0) — written by scripts/critique_briefing.py after generate
    cp = data.get("critic_pass")
    if cp is not None:
        if not isinstance(cp, dict):
            errors.append("'critic_pass' must be an object")
        elif cp:
            if not cp.get("version"):
                warnings.append("critic_pass missing 'version' field")
            scores = cp.get("final_scores")
            if scores is not None:
                if not isinstance(scores, dict):
                    errors.append("critic_pass.final_scores must be an object")
                else:
                    for rule, score in scores.items():
                        if not isinstance(score, (int, float)):
                            warnings.append(
                                f"critic_pass.final_scores.{rule} is not numeric "
                                f"({score!r})"
                            )
                        elif score < 0 or score > 10:
                            warnings.append(
                                f"critic_pass.final_scores.{rule} = {score} "
                                f"out of expected range 0-10"
                            )

    # Em-dash detection — optional, informational
    prose_fields = [data.get("lead", ""), data.get("subheadline", "")]
    for s in data.get("sections") or []:
        if isinstance(s, dict):
            prose_fields.append(s.get("body", ""))
            prose_fields.append(s.get("bottom_line", ""))
    # v4.0: also scan the new prose fields for em-dashes
    for blk_key, blk_fields in [
        ("yesterdays_call", ("summary", "note")),
        ("spread_to_watch", ("commentary",)),
        ("basis", ("body",)),
        ("weekly_thread", ("status_text",)),
    ]:
        blk = data.get(blk_key)
        if isinstance(blk, dict):
            for f in blk_fields:
                v = blk.get(f)
                if isinstance(v, str):
                    prose_fields.append(v)
    em_count = sum(t.count("\u2014") for t in prose_fields if isinstance(t, str))
    if em_count > 6:
        warnings.append(
            f"High em-dash count ({em_count}) — prompt may be producing AI-style prose. "
            "Consider rewriting with periods or parentheses."
        )

    return (len(errors) == 0, errors, warnings)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/daily_schema.py <path/to/daily.json>")
        return 2

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        return 2

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}")
        return 1

    ok, errors, warnings = validate(data)

    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")

    if ok:
        cs = data.get("chart_series") or {}
        cs_note = f", chart_series={list(cs.keys())}" if cs else ""
        # v4.0: surface critic scores in the OK line if present
        cp = data.get("critic_pass") or {}
        cp_note = ""
        if cp.get("final_scores"):
            scores = cp["final_scores"]
            if isinstance(scores, dict) and scores:
                avg = sum(s for s in scores.values() if isinstance(s, (int, float))) / max(len(scores), 1)
                rewrites = len(cp.get("rewrites_applied") or [])
                cp_note = f", critic_avg={avg:.1f}/10"
                if rewrites:
                    cp_note += f" ({rewrites} rewrite{'s' if rewrites != 1 else ''})"
        print(f"OK    {path} — {len(data.get('sections', []))} sections, "
              f"{len(warnings)} warning(s){cs_note}{cp_note}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
