#!/usr/bin/env python3
"""
claude_models.py -- the one place that knows which Claude model does which job,
how to ask each one not to think, and what a call costs.

WHO USES WHAT (2026-11-10)
  WRITER   claude-sonnet-5-5   the daily briefing (generate_daily.py) and the
                               critic that scores and rewrites it
                               (critique_briefing.py). Both write text a
                               reader sees under the owner's name; judgment matters.
  CHECKER  claude-haiku-5-5    the Farmland Atlas county reads
                               (atlas_reads.py). The owner chose the cheaper model
                               there on 2026-10-11; every read is held to a
                               program's number check and voice check whatever
                               wrote it.
  REVIEWER claude-fable-5-2    the fact check before the send
                               (fact_check_briefing.py): the most capable
                               model Anthropic offers, for a careful read of
                               every number against the source data. Its
                               thinking is always on; effort is the control.
                               A 404 or a 400 (the account cannot use it)
                               moves the check to REVIEWER_FALLBACK, Opus 5.5.
  STORY    claude-opus-5-5     county rain stories, the other story sets and
                               the discount schedules (api_jobs.py, batched)
  RESEARCH claude-sonnet-5-5   search review, alt text, elevator sites and
                               county land sources (api_jobs.py, batched)
  ACCURACY claude-opus-5-5     the page accuracy pass (accuracy_pass.py, batched)
  No other file names a model: each job reads its role from here.
  A model the API does not know (404) falls back once to WRITER_FALLBACK, so a
  name change at Anthropic costs a warning and not a morning.

THINKING
  None of these jobs gets extended thinking: it counts against max_tokens (on
  2026-09-19 it ate the whole 400-token read in 828 of 2,331 atlas requests)
  and it is billed. Each model takes a different word for "off":
    claude-sonnet-5-5   {"type": "between_tools"}  ("disabled" is a 400)
    claude-haiku-5-5    {"type": "disabled"}       (allowed at effort high or below;
                                                    its default effort is medium)
    claude-sonnet-5 and older Sonnet / Haiku: {"type": "disabled"}
  "between_tools" is a 400 on every model but Sonnet 5.5, so a request moved to
  another model must have its thinking field rewritten: use with_model().

PRICES are USD per million tokens from Anthropic's pricing as of 2026-11-10:
(input, output, 5-minute cache write, cache read). Haiku 5.5's rate is for a
prompt of 100K tokens or fewer; every prompt here is far under that. Batches are
half price on all of them.
"""

WRITER = "claude-sonnet-5-5"
WRITER_FALLBACK = "claude-sonnet-5"
CHECKER = "claude-haiku-5-5"
REVIEWER = "claude-fable-5-2"
REVIEWER_FALLBACK = "claude-opus-5-5"
STORY = "claude-opus-5-5"
RESEARCH = "claude-sonnet-5-5"
ACCURACY = "claude-opus-5-5"

# Server side refusal fallback (beta). On a safety decline the API reruns the
# same request on the model Anthropic picks for that kind of decline and
# returns that answer, in one round trip. Sent on the fact check and the
# critic (one plain request each). Not on the writer: it streams, and a decline
# part way through would leave half an answer in front of the fallback's whole
# one, so it keeps its own retry on WRITER_FALLBACK. Not on batches (the
# Batches API rejects it) and not on Haiku 5.5 (it has no server fallback).
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS = ("claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5")

PRICES = {
    "claude-fable-5-2": (8.00, 40.00, 10.00, 0.20),
    "claude-fable-5-1": (10.00, 50.00, 12.50, 0.25),
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.10),
    "claude-sonnet-5": (2.00, 10.00, 2.50, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
}

# Smallest prefix each model will cache. A marker on a shorter prefix is ignored
# without an error (cache_creation_input_tokens stays 0).
CACHE_MIN_TOKENS = {
    "claude-fable-5-2": 512,
    "claude-fable-5-1": 512,
    "claude-opus-5-5": 512,
    "claude-sonnet-5-5": 512,
    "claude-haiku-5-5": 512,
    "claude-sonnet-5": 1024,
}

CACHE = {"type": "ephemeral"}


def no_thinking(model):
    """The thinking field that turns extended thinking off on this model.
    Opus 5.5 has none ("disabled" is a 400 there): never send it this."""
    if model.startswith("claude-opus-5-5") or model.startswith("claude-fable"):
        raise ValueError(f"{model} cannot turn thinking off; omit thinking and set effort")
    if model.startswith("claude-sonnet-5-5"):
        return {"type": "between_tools"}
    return {"type": "disabled"}


def with_model(payload, model):
    """A copy of a request body moved to another model, thinking field and all.
    The server fallback stays only on a model that takes it."""
    out = dict(payload)
    out["model"] = model
    if "thinking" in out:
        out["thinking"] = no_thinking(model)
    if "fallbacks" in out and not model.startswith(FALLBACK_MODELS):
        del out["fallbacks"]
    return out


def headers_for(payload, headers):
    """A copy of the request headers with the fallback beta exactly when the
    body asks for the server fallback."""
    h = {k: v for k, v in headers.items() if k != "anthropic-beta"}
    if "fallbacks" in payload:
        h["anthropic-beta"] = FALLBACK_BETA
    return h


def server_fallback(payload, headers):
    """Copies of a request body and its headers with the server side refusal
    fallback turned on, for the models that take it; unchanged otherwise."""
    if not payload.get("model", "").startswith(FALLBACK_MODELS):
        return dict(payload), dict(headers)
    return dict(payload, fallbacks="default"), dict(headers, **{"anthropic-beta": FALLBACK_BETA})


def cached_system(text):
    """A system prompt as one text block marked for caching."""
    return [{"type": "text", "text": text, "cache_control": dict(CACHE)}]


def usage_line(model, usage, batch=False):
    """One log line: the token counts the API reported and what they cost."""
    u = usage or {}
    inp = int(u.get("input_tokens") or 0)
    out = int(u.get("output_tokens") or 0)
    cw = int(u.get("cache_creation_input_tokens") or 0)
    cr = int(u.get("cache_read_input_tokens") or 0)
    c = cost_usd(model, u, batch=batch)
    cost = f"${c:.4f}" if c is not None else "cost unknown (model not in claude_models.PRICES)"
    return (f"usage {model}: input {inp}, cache write {cw}, cache read {cr}, "
            f"output {out}; {cost}")


def usage_table(title, rows):
    """A markdown table of token counts and estimated dollars, one row per job
    and model. rows: (job, model, usage, batch) per response. Counts only: no
    prompt or answer text goes into it."""
    agg = {}
    for job, model, usage, batch in rows:
        u = usage or {}
        k = (job, model, bool(batch))
        a = agg.setdefault(k, [0, 0, 0, 0, 0, 0.0, True])
        a[0] += 1
        a[1] += int(u.get("input_tokens") or 0)
        a[2] += int(u.get("cache_creation_input_tokens") or 0)
        a[3] += int(u.get("cache_read_input_tokens") or 0)
        a[4] += int(u.get("output_tokens") or 0)
        c = cost_usd(model, u, batch=batch)
        if c is None:
            a[6] = False
        else:
            a[5] += c
    lines = [f"### {title}: Claude API usage", "",
             "| job | model | calls | input | cache write | cache read | output | est. USD |",
             "|---|---|---|---|---|---|---|---|"]
    total, known = 0.0, True
    for (job, model, batch), a in sorted(agg.items()):
        usd = f"{a[5]:.4f}" if a[6] else "unknown"
        lines.append(f"| {job} | {model}{' (batch)' if batch else ''} | {a[0]} | {a[1]} | {a[2]} | {a[3]} | {a[4]} | {usd} |")
        total += a[5]
        known = known and a[6]
    if not agg:
        lines.append("| (no calls) | | 0 | 0 | 0 | 0 | 0 | 0.0000 |")
    lines += ["", f"Total estimated: ${total:.4f}" + ("" if known else " (a model with no price is left out)"), ""]
    return "\n".join(lines)


def write_usage_summary(title, rows, summary_path=None):
    """usage_table() on stdout and appended to the job summary page
    ($GITHUB_STEP_SUMMARY) when there is one. Never raises."""
    try:
        md = usage_table(title, rows)
    except Exception as e:  # a log line must never fail a job
        print(f"usage summary skipped ({type(e).__name__})", flush=True)
        return ""
    print(md, flush=True)
    import os
    path = summary_path if summary_path is not None else os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        try:
            with open(path, "a") as f:
                f.write(md + "\n")
        except Exception:
            pass
    return md


def cost_usd(model, usage, batch=False):
    """USD for one response's usage block, or None for a model with no price here."""
    p = PRICES.get(model)
    if not p or usage is None:
        return None
    pi, po, pw, pr = p
    u = usage
    c = (int(u.get("input_tokens") or 0) * pi
         + int(u.get("output_tokens") or 0) * po
         + int(u.get("cache_creation_input_tokens") or 0) * pw
         + int(u.get("cache_read_input_tokens") or 0) * pr) / 1e6
    return c / 2 if batch else c


def probe_payloads():
    """One small request per cached system prompt, built by the jobs' own
    payload builders so the probe sends exactly the prefix they send."""
    import atlas_reads
    import critique_briefing
    import county_stories
    out = []
    p = atlas_reads.request_params("probe", CHECKER)
    out.append(("atlas reads", dict(p, max_tokens=16)))
    p = critique_briefing.critic_payload(WRITER, "Reply with the word ok.", cache=True)
    out.append(("critic", dict(p, max_tokens=16)))
    out.append(("county stories", {"model": STORY, "max_tokens": 16, "output_config": {"effort": "low"},
                                   "system": cached_system(county_stories.SYSTEM),
                                   "messages": [{"role": "user", "content": "Reply with the word ok."}]}))
    return out


def cache_probe(post, payloads):
    """Each payload sent twice; the second must read the cache the first wrote.
    post(payload) returns the response JSON. Returns (rows, all_ok), rows of
    (label, model, first usage, second usage, ok)."""
    rows, all_ok = [], True
    for label, p in payloads:
        u1 = (post(p) or {}).get("usage") or {}
        u2 = (post(p) or {}).get("usage") or {}
        ok = int(u2.get("cache_read_input_tokens") or 0) > 0
        all_ok = all_ok and ok
        rows.append((label, p["model"], u1, u2, ok))
    return rows, all_ok


def _live_post(payload):
    import json
    import os
    import urllib.request
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
                                 data=json.dumps(payload).encode(),
                                 headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"],
                                          "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def run_cache_probe(post=_live_post):
    rows, ok = cache_probe(post, probe_payloads())
    for label, model, u1, u2, good in rows:
        print(f"{label} ({model}): first call cache write {int(u1.get('cache_creation_input_tokens') or 0)}, "
              f"second call cache read {int(u2.get('cache_read_input_tokens') or 0)}: {'ok' if good else 'NOT CACHED'}")
    write_usage_summary("Cache probe", [(r[0], r[1], u, False) for r in rows for u in (r[2], r[3])])
    return 0 if ok else 1


def selftest():
    assert no_thinking("claude-sonnet-5-5") == {"type": "between_tools"}
    assert no_thinking("claude-haiku-5-5") == {"type": "disabled"}
    assert no_thinking("claude-sonnet-5") == {"type": "disabled"}
    p = {"model": WRITER, "thinking": no_thinking(WRITER), "max_tokens": 10}
    q = with_model(p, WRITER_FALLBACK)
    assert q["thinking"] == {"type": "disabled"} and q["model"] == WRITER_FALLBACK
    assert p["thinking"] == {"type": "between_tools"}, "with_model must not change the original"
    # hand-worked: 1M input + 1M output on Sonnet 5.5 is $2 + $10
    assert abs(cost_usd(WRITER, {"input_tokens": 10**6, "output_tokens": 10**6}) - 12.0) < 1e-9
    # 1M cache reads on Haiku 5.5 is a tenth of its $0.10 input rate; batch halves it
    assert abs(cost_usd(CHECKER, {"cache_read_input_tokens": 10**6}) - 0.01) < 1e-12
    assert abs(cost_usd(CHECKER, {"input_tokens": 10**6}, batch=True) - 0.05) < 1e-12
    try:
        no_thinking(REVIEWER)
        raise AssertionError("Fable 5.2 has no thinking-off word")
    except ValueError:
        pass
    try:
        no_thinking(REVIEWER_FALLBACK)
        raise AssertionError("Opus 5.5 has no thinking-off word")
    except ValueError:
        pass
    b, h = server_fallback({"model": REVIEWER}, {"x": "1"})
    assert b["fallbacks"] == "default" and h["anthropic-beta"] == FALLBACK_BETA and h["x"] == "1"
    b, h = server_fallback({"model": CHECKER}, {"x": "1"})
    assert "fallbacks" not in b and "anthropic-beta" not in h, "Haiku 5.5 has no server fallback"
    # hand-worked: 30k input + 3k output on Fable 5.2 is $0.24 + $0.12
    assert REVIEWER == "claude-fable-5-2"
    assert abs(cost_usd(REVIEWER, {"input_tokens": 30000, "output_tokens": 3000}) - 0.36) < 1e-9
    # Sonnet 5.5 cache reads are $0.10 per million
    assert abs(cost_usd(WRITER, {"cache_read_input_tokens": 10**6}) - 0.10) < 1e-12
    b, h = server_fallback({"model": WRITER}, {})
    assert b["fallbacks"] == "default", "the critic on Sonnet 5.5 takes the server fallback"
    q = with_model(dict(b, thinking=no_thinking(WRITER)), WRITER_FALLBACK)
    assert "fallbacks" not in q and q["thinking"] == {"type": "disabled"}, "Sonnet 5 gets no fallbacks field"
    assert headers_for(b, {"x": "1"}) == {"x": "1", "anthropic-beta": FALLBACK_BETA}
    assert headers_for(q, {"x": "1", "anthropic-beta": FALLBACK_BETA}) == {"x": "1"}
    # the usage table: counts and dollars, grouped by job and model, batch halved
    md = usage_table("t", [("reads", CHECKER, {"input_tokens": 10**6, "cache_read_input_tokens": 10**6}, True),
                           ("reads", CHECKER, {"output_tokens": 10**6}, True),
                           ("x", "claude-unknown", {"input_tokens": 5}, False)])
    assert "| reads | claude-haiku-5-5 (batch) | 2 | 1000000 | 0 | 1000000 | 1000000 | 0.3050 |" in md, md
    assert "| x | claude-unknown | 1 | 5 | 0 | 0 | 0 | unknown |" in md and "Total estimated: $0.3050" in md, md
    import os
    import tempfile
    sp = os.path.join(tempfile.mkdtemp(), "summary.md")
    write_usage_summary("t", [("w", WRITER, {"input_tokens": 1}, False)], summary_path=sp)
    assert "| w | claude-sonnet-5-5 | 1 | 1 |" in open(sp).read()
    # the cache probe: a second call that reads no cache fails it
    calls = []

    def fake(p):
        calls.append(p["model"])
        n = sum(1 for m in calls if m == p["model"])
        return {"usage": {"cache_creation_input_tokens": 900 if n == 1 else 0,
                          "cache_read_input_tokens": 0 if n == 1 or p["model"] == STORY else 900}}
    rows, ok = cache_probe(fake, [("a", {"model": WRITER}), ("b", {"model": CHECKER})])
    assert ok and [r[4] for r in rows] == [True, True]
    rows, ok = cache_probe(fake, [("c", {"model": STORY})])
    assert not ok and rows[0][4] is False
    labels = [lbl for lbl, p in probe_payloads()]
    assert labels == ["atlas reads", "critic", "county stories"]
    for lbl, p in probe_payloads():
        sysb = p["system"]
        assert isinstance(sysb, list) and sysb[-1]["cache_control"] == CACHE, lbl
        assert p["max_tokens"] == 16 and "temperature" not in p, lbl
    assert cost_usd("claude-unknown", {"input_tokens": 1}) is None
    for m in PRICES:
        assert m in CACHE_MIN_TOKENS, m
    print("claude_models selftest ok")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
    elif "--cache-probe" in sys.argv:
        # two small paid calls per cached prompt; never run by a test or a schedule
        if "--live" not in sys.argv:
            sys.exit("--cache-probe makes paid API calls; add --live to run it")
        sys.exit(run_cache_probe())
