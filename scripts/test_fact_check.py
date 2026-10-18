#!/usr/bin/env python3
"""Fixtures for fact_check_briefing.py and the model request shapes. No API key,
no network: the reviewer is a stand-in that reads the same payload the real one
would get. Run: python3 scripts/test_fact_check.py"""

import copy
import datetime as dt
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import claude_models  # noqa: E402
import fact_check_briefing as fc  # noqa: E402

TODAY = dt.date(2026, 10, 17)   # a Saturday

CLEAN = {
    "date": "Saturday, October 17, 2026",
    "headline": "Corn eases into the weekend",
    "lead": "Corn settled at $4.74 on Friday, Oct 16, down 3 cents.",
    "sections": [{"title": "Grains", "body": "- December corn settled at **$4.74**, down 3 cents.",
                  "so_what": "Harvest supply keeps the pressure on."}],
    "watch_list": [{"time": "Monday, Oct 19, 3:00 p.m. CT", "desc": "Crop Progress."}],
    "locked_prices": {"corn": 4.7425, "corn-dec": 4.7425},
    "locked_changes": {"corn": {"chg": -0.0375}},
    "board": {"quote_session": "2026-10-16"},
}

INPUTS = {"user_message": "LOCKED PRICE TABLE (use ONLY these; do not invent):\n  Corn (Dec) $4.74 -3.75c\nNEWS: ...",
          "system_day_part": "calendar"}


def fake_reviewer(payload, api_key):
    """Stands in for the model: reads the locked corn price out of the SOURCE
    DATA it was handed and every "$N" after "corn" in the DRAFT, and reports a
    high mismatch when they differ by more than a cent. It sees only what the
    real reviewer would see, so it proves the payload carries both."""
    content = payload["messages"][0]["content"]
    src, draft = content.split("\nDRAFT\n", 1)
    m = re.search(r'"corn":\s*([\d.]+)', src)
    assert m, "the locked prices must be in the source data"
    true = float(m.group(1))
    findings = []
    for line in draft.splitlines():
        if ":" not in line:
            continue
        path, text = line.split(": ", 1)
        for mm in re.finditer(r"corn[^$]{0,30}\$(\d+\.\d\d)", text, re.I):
            if abs(float(mm.group(1)) - true) > 0.01:
                findings.append({"severity": "high", "kind": "mismatch", "field": path,
                                 "quote": "$" + mm.group(1), "expected": f"${true:.2f}",
                                 "source": "LOCKED PRICE TABLE corn", "explanation": "price differs"})
    return {"stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 100},
            "content": [{"type": "thinking", "thinking": ""},
                        {"type": "text", "text": json.dumps({"findings": findings, "summary": "ok"})}]}


def run_on(daily, post=fake_reviewer, key="test-key", inputs=INPUTS):
    d = tempfile.mkdtemp()
    p = os.path.join(d, "daily.json")
    with open(p, "w") as f:
        json.dump(daily, f)
    ip = os.path.join(d, "inputs.json")
    if inputs is not None:
        with open(ip, "w") as f:
            json.dump(inputs, f)
    os.environ["RUNNER_TEMP"] = d
    os.environ.pop("GITHUB_STEP_SUMMARY", None)
    return fc.run(p, post=post, api_key=key, today=TODAY, inputs_path=ip, calendar="CALENDAR")


def main():
    fc.MODE = "block"
    # 1. a clean draft passes
    assert run_on(CLEAN) == 0, "clean draft must pass"

    # 2. a planted wrong price fails
    bad = copy.deepcopy(CLEAN)
    bad["sections"][0]["body"] = "- December corn settled at **$4.92**, down 3 cents."
    assert run_on(bad) == 1, "a wrong corn price must block"

    # 3. a planted wrong date fails, by code, even with no API key
    bad = copy.deepcopy(CLEAN)
    bad["watch_list"][0]["time"] = "Monday, Oct 20, 3:00 p.m. CT"   # Oct 20 2026 is a Tuesday
    assert run_on(bad, key="") == 1, "a weekday that is not its date must block"
    assert run_on(bad) == 1
    assert fc.weekday_findings([("x", "Friday, Oct 16")], TODAY) == []
    assert fc.weekday_findings([("x", "Thurs., Oct 22")], TODAY) == []
    assert len(fc.weekday_findings([("x", "Saturday, October 17, 2025")], TODAY)) == 1
    assert fc.weekday_findings([("x", "Friday, Jan 8")], dt.date(2026, 12, 30)) == [], "next January"

    # 4. a finding whose quote is not in the draft never blocks
    def hallucinating(payload, key):
        r = fake_reviewer(payload, key)
        r["content"][1]["text"] = json.dumps({"findings": [{
            "severity": "high", "kind": "mismatch", "field": "lead", "quote": "$9.99",
            "expected": "$4.74", "source": "x", "explanation": "made up"}], "summary": ""})
        return r
    assert run_on(CLEAN, post=hallucinating) == 0, "an unverifiable quote must not block"
    v = fc.verify([{"severity": "high", "kind": "mismatch", "field": "lead", "quote": "$9.99"}],
                  fc.draft_fields(CLEAN))
    assert v[0]["severity"] == "medium" and not v[0]["verified"]

    # 5. without the writer's inputs an unsourced number is shown, not blocking
    v = fc.verify([{"severity": "high", "kind": "unsourced_number", "field": "lead", "quote": "down 3 cents"}],
                  fc.draft_fields(CLEAN), inputs_present=False)
    assert v[0]["severity"] == "medium"

    # 6. the reviewer failing is fail-open; report mode never blocks
    def broken(payload, key):
        raise RuntimeError("HTTP 500: overloaded")
    assert run_on(CLEAN, post=broken) == 0
    bad = copy.deepcopy(CLEAN)
    bad["lead"] = "Corn settled at $5.10 on Friday, Oct 16."
    fc.MODE = "report"
    assert run_on(bad) == 0
    fc.MODE = "block"
    assert run_on(bad) == 1

    # 7. a refusal on the reviewer moves down the chain once per model
    seen = []
    def refuse_then_ok(payload, key):
        seen.append(payload["model"])
        if payload["model"] == claude_models.REVIEWER:
            return {"stop_reason": "refusal", "content": []}
        return fake_reviewer(payload, key)
    assert run_on(CLEAN, post=refuse_then_ok) == 0 and seen == [claude_models.REVIEWER, claude_models.REVIEWER_FALLBACK]
    # an account that cannot use the reviewer (400), then a refusal, ends on the writer
    seen.clear()
    def no_access(payload, key):
        seen.append(payload["model"])
        if payload["model"] == claude_models.REVIEWER:
            raise RuntimeError("HTTP 400: invalid_request_error")
        if payload["model"] == claude_models.REVIEWER_FALLBACK:
            return {"stop_reason": "refusal", "content": []}
        assert payload["thinking"] == {"type": "adaptive"} and "fallbacks" not in payload
        return fake_reviewer(payload, key)
    assert run_on(bad, post=no_access) == 1 and seen == [claude_models.REVIEWER, claude_models.REVIEWER_FALLBACK, claude_models.WRITER]
    # refused everywhere: fail-open, the code checks still ran
    assert run_on(CLEAN, post=lambda p, k: {"stop_reason": "refusal", "content": []}) == 0

    # 8. the fact check never writes the draft
    d = copy.deepcopy(bad)
    run_on(d)
    assert d == bad

    # 9. machine fields are source data, not draft
    paths = [p for p, _ in fc.draft_fields(CLEAN)]
    assert "lead" in paths and not any(p.startswith("locked_prices") for p in paths)

    request_shapes()
    print("test_fact_check ok")


def request_shapes():
    """Model ids, thinking word, cache marker and max_tokens of every call."""
    # the fact check
    p = fc.review_payload([("lead", "x")], "SRC", model=claude_models.REVIEWER)
    assert p["model"] == "claude-fable-5-1"
    assert "thinking" not in p, "Fable 5.1 400s on any thinking setting but adaptive; omit it"
    assert p["fallbacks"] == "default", "a safety decline reruns server side"
    assert p["output_config"]["effort"] == "high"
    assert p["output_config"]["format"]["type"] == "json_schema"
    assert p["system"] == fc.SYSTEM, "one call on this model per run: no cache write that is never read"
    po = fc._moved(p, claude_models.REVIEWER_FALLBACK)
    assert po["model"] == "claude-opus-5-5" and "thinking" not in po and po["fallbacks"] == "default"
    assert p["max_tokens"] == 16000
    assert not any(k in p for k in ("temperature", "top_p", "top_k"))
    assert "SRC" in p["messages"][0]["content"] and "lead: x" in p["messages"][0]["content"]

    # the generator
    import generate_daily as g
    assert g.MODEL == os.environ.get("BRIEFING_MODEL", "").strip() or g.MODEL == "claude-sonnet-5-5"
    assert g.FALLBACK_MODEL == "claude-sonnet-5"
    ms = {"is_closed": False, "reason": "", "day_name": "Tuesday", "note": ""}
    a = g.build_system_prompt(ms, [], None, None, "", "", [], [], "")
    b = g.build_system_prompt({"is_closed": True, "reason": "weekend", "day_name": "Sunday", "note": ""},
                              [], None, None, "ONGOING", "NOTES", [], [], "USDA CORRECTION")
    pa, pb = g.briefing_payload("claude-sonnet-5-5", a, "u"), g.briefing_payload("claude-sonnet-5-5", b, "u")
    assert pa["thinking"] == {"type": "between_tools"}, "Sonnet 5.5 400s on disabled"
    assert pa["max_tokens"] == 4500
    assert len(pa["system"]) == 2 and pa["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in pa["system"][1]
    assert "".join(x["text"] for x in pa["system"]) == a, "the model must see the same prompt text"
    assert pa["system"][0]["text"] == pb["system"][0]["text"], "the cached part must not change by day"
    assert "USDA CORRECTION" in pb["system"][1]["text"] and "USDA CORRECTION" not in pb["system"][0]["text"]
    assert len(pa["system"][0]["text"]) > 4 * 512, "the cached part must clear the 512-token minimum"
    fb = claude_models.with_model(pa, g.FALLBACK_MODEL)
    assert fb["thinking"] == {"type": "disabled"} and fb["model"] == "claude-sonnet-5"
    assert g.system_blocks("no anchor here") == [{"type": "text", "text": "no anchor here"}]

    # the critic
    import critique_briefing as c
    cp = c.critic_payload("claude-sonnet-5-5", "u")
    assert cp["thinking"] == {"type": "between_tools"} and cp["max_tokens"] == 4000
    assert cp["system"] == c.CRITIC_SYSTEM, "one pass: no cache write that is never read"
    cp2 = c.critic_payload("claude-sonnet-5-5", "u", cache=True)
    assert cp2["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert c.FALLBACK_MODEL == "claude-sonnet-5"

    # the atlas reads
    import atlas_reads as ar
    rp = ar.request_params("block", "claude-haiku-5-5")
    assert rp["thinking"] == {"type": "disabled"} and rp["max_tokens"] == 400
    assert rp["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert ar.MODEL == (os.environ.get("ATLAS_READS_MODEL", "").strip() or "claude-haiku-5-5")


if __name__ == "__main__":
    main()
