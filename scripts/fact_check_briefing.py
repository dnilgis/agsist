#!/usr/bin/env python3
"""
fact_check_briefing.py -- the last read of the AGSIST Daily before it can send.

Runs in daily.yml after the critic and before GATE 2. A careful reviewer model
(claude_models.REVIEWER, Claude Fable 5.1 at effort high, the most capable
model Anthropic offers; Opus 5.5 if the account cannot use it) gets the draft and the
exact source data the generator used, and returns structured findings:
  mismatch               a claim the data contradicts (a price, a change, a level)
  unsourced_number       a number that appears in none of the inputs
  wrong_date             a date, weekday or release day the calendar contradicts
  wrong_contract_month   a contract month the board does not show
  settle_for_last_trade  "settled"/"settlement"/"close" for a quote that is not a settle
  other                  anything else that is not true to the inputs

WHAT IT NEVER DOES: it never changes daily.json. It reports. A rewrite of a
number by a model is exactly what it exists to catch.

WHAT BLOCKS THE SEND: a high-severity finding that this script can verify, i.e.
its quoted text is really in the draft. A finding whose quote is not in the
draft is the reviewer's mistake and is shown, downgraded, without blocking.
Exit 1 then stops the job before GATE 2, the commit and the send, the same as
any gate; the next morning cron regenerates. A weekday that does not match its
date is checked by code here as well, with no model involved.

FAIL-OPEN ON ITS OWN FAILURE: no key, an API error, a refusal or an answer that
does not parse leaves a ::warning:: and exits 0. The deterministic GATE 2 still
runs. An outage at Anthropic must not stop a briefing the gates passed.

FACT_CHECK_MODE=report keeps every finding in the log and summary and never
blocks (for a week of calibration if the reviewer turns out noisy).

Inputs (all read-only):
  data/daily.json         the draft (after the critic)
  data/prices.json        the feed the locked price table was built from
  data/daily-edge.json    the "Only on AGSIST" facts counted from the bid boards
  data/wasde.json         the WASDE figures
  generate_daily.CALENDAR_FACTS_2026 + weekly_release_line() + get_usda_release_today()
  $RUNNER_TEMP/agsist-briefing-inputs.json   the generator's own user message
      (locked table, price timing block, news digest) and the day part of its
      system prompt, written by generate_daily.save_briefing_inputs()

Outputs: findings in the log, ::error::/::warning:: annotations, a table in
$GITHUB_STEP_SUMMARY, and $RUNNER_TEMP/fact-check.json. No subscriber data is
read or written.

Usage:
  python scripts/fact_check_briefing.py             (needs ANTHROPIC_API_KEY)
  python scripts/fact_check_briefing.py --selftest
"""

import json
import os
import re
import sys
import tempfile
import time
import datetime as dt
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import claude_models  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
API = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("FACT_CHECK_MODEL", "").strip() or claude_models.REVIEWER
MODE = (os.environ.get("FACT_CHECK_MODE", "").strip() or "block").lower()
KINDS = ["mismatch", "unsourced_number", "wrong_date", "wrong_contract_month",
         "settle_for_last_trade", "other"]
SEVERITIES = ["high", "medium", "low"]

# Fields the generator's code writes from data, not the model. They are sent as
# source data; the findings are about what the model wrote.
MACHINE_FIELDS = {"locked_prices", "locked_changes", "board", "harvest_clock", "edge",
                  "chart_series", "chart_dates", "chart_window", "quote_strip", "sponsor",
                  "issue_number", "generated_at", "generator_version", "surprise_count",
                  "surprises", "price_validation_clean", "market_closed",
                  "market_status_reason", "meta", "critic_pass", "cca_note",
                  "source_summary", "daily_quote"}

SYSTEM = """You are the fact checker for the AGSIST Daily, a morning farm markets briefing that goes to farmers under Sig Lindquist's name. A writer drafted it from source data. You check the draft against that source data and nothing else. You do not judge style, voice or length, and you do not suggest wording.

You are given:
1. DRAFT: every reader-facing text field of the briefing, one per line, as field path and text.
2. SOURCE DATA: the exact inputs the writer had. The LOCKED PRICE TABLE and PRICE TIMING block in the writer's message are the authority for every futures price, change and percent. prices.json is the feed that table came from. The board block says which session the quotes are from. The calendar block and the weekly release line are the authority for holidays and USDA release days and times. wasde.json is the authority for WASDE figures. The "Only on AGSIST" facts are counted by code from elevator bid boards. The news digest in the writer's message is the source for numbers about events, exports, weather, policy and other markets.

Report a finding for each of these:
- mismatch: a price, change, percent, level, direction or other figure that the source data contradicts. Grain prices may be written in dollars with fractions (for example $4.74 and a quarter written as $4.74 with the fraction sign) or as cents; treat equal values as equal. A rounded figure that a farmer would read as the same number (4.742 written as $4.74) is not a mismatch. A direction word that contradicts the sign of the change is a mismatch.
- unsourced_number: a specific number (a price, a percent, a count, a quantity, a date figure) that appears in none of the source data and cannot be read off it directly. Simple restatements are sourced: a change in cents written from the table, a price rounded to the cent, a weekday read off a date. A figure the writer computed, such as a gap between two prices or a share, is unsourced unless it is exactly right from the data; if it is exactly right, do not report it.
- wrong_date: a date, a weekday, or a report day and time that the calendar or the weekly release line contradicts, or a weekday that does not match its date in the year given.
- wrong_contract_month: a contract month (December corn, November beans, a "Dec" or "Nov" label) that the board or price table does not show for that commodity.
- settle_for_last_trade: the word settled, settle, settlement, or "closed at" used for a price that the PRICE TIMING block says is a live or last-trade quote, not a settlement. When there is no PRICE TIMING block, the table is settlements and the word is fine.
- other: any other statement that the source data shows to be false.

Severity:
- high: a reader would be told a wrong number, a wrong date or day, a wrong contract month, a settle that is not one, or a number with no source. These stop the briefing.
- medium: likely wrong but the data is ambiguous, or the claim is a characterization the data only partly supports.
- low: a nit a careful editor would mention.

Rules for your answer:
- quote must be copied character for character from the DRAFT field you name, short (the number and the few words around it). A program checks that the quote is in that field; a finding whose quote is not there is discarded.
- source names where the true value is (for example "LOCKED PRICE TABLE corn" or "calendar: Crop Progress"), and expected gives the value the data supports, or "no source".
- Do not report something because it is missing from the draft. Do not report opinions, forecasts or "watch" levels a writer chose as levels to watch, unless they are presented as a fact about today.
- If the writer's message is marked NOT AVAILABLE, numbers that could come from the news digest cannot be checked: report those as low, never high.
- An empty findings list is the right answer for a clean draft. Do not invent findings to have something to say."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["findings", "summary"],
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["severity", "kind", "field", "quote", "expected", "source", "explanation"],
                "properties": {
                    "severity": {"type": "string", "enum": SEVERITIES},
                    "kind": {"type": "string", "enum": KINDS},
                    "field": {"type": "string"},
                    "quote": {"type": "string"},
                    "expected": {"type": "string"},
                    "source": {"type": "string"},
                    "explanation": {"type": "string"},
                },
            },
        },
        "summary": {"type": "string"},
    },
}


# ── the draft ────────────────────────────────────────────────────────────────

def draft_fields(daily):
    """[(path, text)] for every string the model wrote, in document order."""
    out = []

    def walk(v, path):
        if isinstance(v, str):
            if v.strip():
                out.append((path, v))
        elif isinstance(v, dict):
            for k, x in v.items():
                walk(x, f"{path}.{k}" if path else k)
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}[{i}]")

    for k, v in daily.items():
        if k in MACHINE_FIELDS:
            continue
        walk(v, k)
    return out


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("**", "")).strip().lower()


# ── checks done by code ──────────────────────────────────────────────────────

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
_MON = "|".join(MONTHS + [m[:3] for m in MONTHS] + ["Sept"])
WEEKDAY_DATE = re.compile(
    r"\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun)\.?,?\s+"
    r"(" + _MON + r")\.?\s+(\d{1,2})\b(?:,?\s+(20\d\d))?")
_WD = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _month_num(name):
    n = name[:3].lower()
    for i, m in enumerate(MONTHS):
        if m[:3].lower() == n:
            return i + 1
    return None


def weekday_findings(fields, today):
    """A weekday that does not fall on its date. The year is the one written,
    else the date's nearest occurrence to today (a "Friday, Jan 8" in a late
    December issue is next year's)."""
    out = []
    for path, text in fields:
        for m in WEEKDAY_DATE.finditer(text):
            wd = _WD[m.group(1)[:3].lower()]
            mon, day = _month_num(m.group(2)), int(m.group(3))
            years = [int(m.group(4))] if m.group(4) else [today.year - 1, today.year, today.year + 1]
            cands = []
            for y in years:
                try:
                    cands.append(dt.date(y, mon, day))
                except ValueError:
                    pass
            if not cands:
                out.append(_code_finding(path, m.group(0), "a real date", "no such date"))
                continue
            d = min(cands, key=lambda c: abs((c - today).days))
            if d.weekday() != wd:
                out.append(_code_finding(path, m.group(0), d.strftime("%A, %B %-d, %Y"),
                                         f"{d.isoformat()} is a {d.strftime('%A')}"))
    return out


def _code_finding(path, quote, expected, why):
    return {"severity": "high", "kind": "wrong_date", "field": path, "quote": quote,
            "expected": expected, "source": "calendar (checked by code)",
            "explanation": why, "verified": True, "by": "code"}


# ── the review call ──────────────────────────────────────────────────────────

def _read(path):
    try:
        with open(path) as f:
            return f.read()
    except Exception:
        return None


def calendar_text(today):
    """The calendar block, this week's release line and today's USDA note, from
    the generator's own definitions (never a copy)."""
    parts = []
    try:
        import generate_daily as g
        parts.append(g.CALENDAR_FACTS_2026.strip())
        try:
            parts.append(g.weekly_release_line(today) or "")
        except TypeError:
            parts.append(g.weekly_release_line() or "")
        try:
            parts.append(g.get_usda_release_today() or "")
        except Exception:
            pass
    except Exception as e:
        parts.append(f"(calendar unavailable: {type(e).__name__}: {e})")
    return "\n\n".join(p for p in parts if p)


def source_block(daily, prices_txt, edge_txt, wasde_txt, inputs, calendar):
    machine = {k: daily.get(k) for k in ("date", "board", "locked_prices", "locked_changes",
                                         "market_closed", "market_status_reason", "edge",
                                         "harvest_clock") if daily.get(k) is not None}
    if inputs:
        writer = ("WRITER'S MESSAGE (locked price table, price timing, surprises, seasonal note, "
                  "past issues, news digest):\n" + inputs.get("user_message", "")
                  + "\n\nWRITER'S DAY CONTEXT (from its system prompt):\n" + inputs.get("system_day_part", ""))
    else:
        writer = ("WRITER'S MESSAGE: NOT AVAILABLE (the generator's saved inputs were not found; "
                  "the news digest cannot be checked).")
    return "\n\n".join([
        writer,
        "ISSUE FIELDS WRITTEN BY CODE FROM DATA (board, locked prices, changes, edge facts):\n"
        + json.dumps(machine, ensure_ascii=False, indent=1),
        "CALENDAR:\n" + calendar,
        "data/prices.json:\n" + (prices_txt or "(missing)"),
        "data/daily-edge.json:\n" + (edge_txt or "(missing)"),
        "data/wasde.json:\n" + (wasde_txt or "(missing)"),
    ])


def review_payload(fields, sources, model=None):
    model = model or MODEL
    draft = "\n".join(f"{p}: {t}" for p, t in fields)
    p = {
        "model": model,
        "max_tokens": 16000,           # thinking counts against it; the findings are short
        # Fable 5.1 and Opus 5.5 cannot turn thinking off; effort is the
        # control, and a careful review is worth "high".
        "output_config": {"effort": "high",
                          "format": {"type": "json_schema", "schema": SCHEMA}},
        # Not cached: this is the only call in the run on this model, and a
        # cache write costs a quarter more than plain input and is never read.
        "system": SYSTEM,
        "messages": [{"role": "user", "content":
                      "SOURCE DATA\n\n" + sources + "\n\nDRAFT\n\n" + draft
                      + "\n\nCheck the DRAFT against the SOURCE DATA and return the findings."}],
    }
    if model.startswith("claude-sonnet") or model.startswith("claude-haiku"):
        # a cheaper stand-in set by FACT_CHECK_MODEL still reviews with thinking on
        p["thinking"] = {"type": "adaptive"}
    # a safety decline is rerun server side on Anthropic's pick (beta)
    p, _ = claude_models.server_fallback(p, {})
    return p


def _post(payload, api_key):
    import urllib.request
    import urllib.error
    headers = {"Content-Type": "application/json", "x-api-key": api_key,
               "anthropic-version": "2023-06-01"}
    if "fallbacks" in payload:
        headers["anthropic-beta"] = claude_models.FALLBACK_BETA
    data = json.dumps(payload).encode("utf-8")
    delays = [5, 20, 45]
    for attempt in range(len(delays) + 1):
        try:
            req = urllib.request.Request(API, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=600) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            if e.code in (408, 429, 500, 502, 503, 529) and attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise RuntimeError(f"HTTP {e.code}: {body}")
        except Exception as e:
            if attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise RuntimeError(f"network: {type(e).__name__}: {e}")


def _moved(payload, model):
    """The same review on another model: the thinking field and the server
    fallback follow the model."""
    p = {k: v for k, v in payload.items() if k not in ("thinking", "fallbacks")}
    p["model"] = model
    if not model.startswith(("claude-fable", "claude-opus")):
        p["thinking"] = {"type": "adaptive"}
    p, _ = claude_models.server_fallback(p, {})
    return p


def call_reviewer(payload, api_key, post=_post):
    """(findings, usage, model, summary) or raises. A refusal, a 404 (unknown
    model) or a 400 (for example an account that cannot use Fable 5.1) moves
    the review down the chain once per model: REVIEWER, REVIEWER_FALLBACK,
    WRITER. The strongest model is a preference, not a requirement for the
    check to run."""
    chain = [m for m in (claude_models.REVIEWER_FALLBACK, claude_models.WRITER) if m != payload["model"]]
    while True:
        try:
            r = post(payload, api_key)
            if r.get("stop_reason") == "refusal":
                raise RuntimeError("stop_reason refusal")
            break
        except RuntimeError as e:
            msg = str(e)
            if not chain or not ("refusal" in msg or "HTTP 404" in msg or "HTTP 400" in msg):
                raise
            nxt = chain.pop(0)
            print(f"::warning title=Fact check model fallback::{payload['model']} ({msg[:160]}); "
                  f"reviewing on {nxt}", flush=True)
            payload = _moved(payload, nxt)
    if r.get("stop_reason") == "max_tokens":
        raise RuntimeError("answer cut off at max_tokens")
    text = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text").strip()
    data = json.loads(text)
    # a server side fallback answers on another model: bill the one that answered
    model = r.get("model") or payload["model"]
    return data.get("findings") or [], r.get("usage") or {}, model, data.get("summary", "")


# ── deciding ─────────────────────────────────────────────────────────────────

def verify(findings, fields, inputs_present=True):
    """Each model finding marked verified when its quote is in the named field
    (or, failing that, anywhere in the draft). An unverified high is shown as
    medium and does not block. Without the writer's inputs, an
    unsourced_number cannot be told from a news figure: shown as medium."""
    by_path = {p: _norm(t) for p, t in fields}
    whole = " \n ".join(by_path.values())
    out = []
    for f in findings:
        f = dict(f)
        q = _norm(f.get("quote"))
        f["verified"] = bool(q) and (q in by_path.get(f.get("field"), "") or q in whole)
        f.setdefault("by", "model")
        if f.get("severity") == "high" and not f["verified"]:
            f["severity"] = "medium"
            f["explanation"] = "(quote not found in the draft; not blocking) " + (f.get("explanation") or "")
        if f.get("severity") == "high" and f.get("kind") == "unsourced_number" and not inputs_present:
            f["severity"] = "medium"
            f["explanation"] = "(writer inputs missing; not blocking) " + (f.get("explanation") or "")
        out.append(f)
    return out


def blocking(findings):
    return [f for f in findings if f.get("severity") == "high" and f.get("verified")]


def summary_md(findings, model, usage, note=""):
    lines = ["## Fact check", ""]
    c = claude_models.cost_usd(model, usage) if usage else None
    lines.append(f"Reviewer: `{model}`" + (f", cost ${c:.4f}" if c is not None else "")
                 + (f". {note}" if note else ""))
    lines.append("")
    if not findings:
        lines.append("No findings.")
        return "\n".join(lines) + "\n"
    lines += ["| severity | kind | field | draft says | data says | source | by |",
              "|---|---|---|---|---|---|---|"]
    esc = lambda s: str(s or "").replace("|", "\\|").replace("\n", " ")[:160]
    for f in sorted(findings, key=lambda f: SEVERITIES.index(f.get("severity", "low"))):
        lines.append(f"| {esc(f.get('severity'))} | {esc(f.get('kind'))} | {esc(f.get('field'))} | "
                     f"{esc(f.get('quote'))} | {esc(f.get('expected'))} | {esc(f.get('source'))} | {esc(f.get('by'))} |")
    return "\n".join(lines) + "\n"


def report(findings, model, usage, note=""):
    for f in findings:
        lvl = "error" if (f.get("severity") == "high" and f.get("verified")) else "warning"
        msg = (f"{f.get('kind')} in {f.get('field')}: \"{f.get('quote')}\"; data: {f.get('expected')} "
               f"({f.get('source')}). {f.get('explanation')}").replace("\n", " ")
        print(f"::{lvl} title=Fact check {f.get('severity')}::{msg[:900]}", flush=True)
    md = summary_md(findings, model, usage, note)
    print(md)
    sp = os.environ.get("GITHUB_STEP_SUMMARY")
    if sp:
        try:
            with open(sp, "a") as f:
                f.write(md)
        except Exception:
            pass
    try:
        out = os.path.join(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir(), "fact-check.json")
        with open(out, "w") as f:
            json.dump({"model": model, "usage": usage, "findings": findings, "note": note}, f, indent=1)
    except Exception:
        pass


def run(daily_path, post=_post, api_key=None, today=None, inputs_path=None, calendar=None):
    """Returns the exit code. post and calendar are seams for the tests."""
    api_key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY", "")
    with open(daily_path) as f:
        daily = json.load(f)
    today = today or dt.datetime.now(dt.timezone.utc).date()
    fields = draft_fields(daily)
    findings = weekday_findings(fields, today)
    note = ""
    usage, model = {}, MODEL
    if inputs_path is None:
        import generate_daily as g
        inputs_path = g.briefing_inputs_path()
    inputs = None
    try:
        inputs = json.loads(_read(inputs_path) or "null")
    except ValueError:
        inputs = None
    if not api_key:
        note = "ANTHROPIC_API_KEY not set: the model review was skipped, code checks only."
        print(f"::warning title=Fact check::{note}")
    else:
        sources = source_block(daily, _read(REPO / "data" / "prices.json"),
                               _read(REPO / "data" / "daily-edge.json"),
                               _read(REPO / "data" / "wasde.json"), inputs,
                               calendar if calendar is not None else calendar_text(today))
        try:
            mf, usage, model, summ = call_reviewer(review_payload(fields, sources), api_key, post=post)
            findings += verify(mf, fields, inputs_present=bool(inputs))
            note = summ
            print("  " + claude_models.usage_line(model, usage), flush=True)
        except Exception as e:
            note = f"model review failed ({type(e).__name__}: {str(e)[:200]}); code checks only"
            print(f"::warning title=Fact check skipped::{note}", flush=True)
    report(findings, model, usage, note)
    stop = blocking(findings)
    if stop and MODE != "report":
        print(f"FACT CHECK: {len(stop)} high-severity finding(s); the briefing does not send.")
        return 1
    if stop:
        print(f"FACT CHECK (report mode): {len(stop)} high-severity finding(s); not blocking.")
    else:
        print("FACT CHECK: passed.")
    return 0


def selftest():
    import test_fact_check  # noqa: F401  the fixtures live in scripts/test_fact_check.py
    test_fact_check.main()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    sys.exit(run(str(REPO / "data" / "daily.json")))
