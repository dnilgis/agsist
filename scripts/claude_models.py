#!/usr/bin/env python3
"""
claude_models.py -- the one place that knows which Claude model does which job,
how to ask each one not to think, and what a call costs.

WHO USES WHAT (2026-10-17)
  WRITER   claude-sonnet-5-5   the daily briefing (generate_daily.py) and the
                               critic that scores and rewrites it
                               (critique_briefing.py). Both write text a
                               reader sees under Sig's name; judgment matters.
  CHECKER  claude-haiku-5-5    the Farmland Atlas county reads
                               (atlas_reads.py). Sig chose the cheaper model
                               there on 2026-10-11; every read is held to a
                               program's number check and voice check whatever
                               wrote it.
  REVIEWER claude-fable-5-1    the fact check before the send
                               (fact_check_briefing.py): the most capable
                               model Anthropic offers, for a careful read of
                               every number against the source data. Its
                               thinking is always on; effort is the control.
                               A 404 or a 400 (the account cannot use it)
                               moves the check to REVIEWER_FALLBACK, Opus 5.5.
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

PRICES are USD per million tokens from Anthropic's pricing as of 2026-10-17:
(input, output, 5-minute cache write, cache read). Haiku 5.5's rate is for a
prompt of 100K tokens or fewer; every prompt here is far under that. Batches are
half price on all of them.
"""

WRITER = "claude-sonnet-5-5"
WRITER_FALLBACK = "claude-sonnet-5"
CHECKER = "claude-haiku-5-5"
REVIEWER = "claude-fable-5-1"
REVIEWER_FALLBACK = "claude-opus-5-5"

# Server side refusal fallback (beta). On a safety decline the API reruns the
# same request on the model Anthropic picks for that kind of decline and
# returns that answer, in one round trip. Sent on the fact check only: the
# writer and critic already retry a refusal on WRITER_FALLBACK themselves, the
# Batches API (atlas reads) rejects it, and Haiku 5.5 has no server fallback.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
FALLBACK_MODELS = ("claude-fable-5-1", "claude-opus-5-5")

PRICES = {
    "claude-fable-5-1": (10.00, 50.00, 12.50, 0.25),
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.20),
    "claude-sonnet-5": (2.00, 10.00, 2.50, 0.20),
    "claude-sonnet-4-6": (3.00, 15.00, 3.75, 0.30),
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
    "claude-haiku-4-5-20251001": (1.00, 5.00, 1.25, 0.10),
    "claude-haiku-4-5": (1.00, 5.00, 1.25, 0.10),
}

# Smallest prefix each model will cache. A marker on a shorter prefix is ignored
# without an error (cache_creation_input_tokens stays 0).
CACHE_MIN_TOKENS = {
    "claude-fable-5-1": 512,
    "claude-opus-5-5": 512,
    "claude-sonnet-5-5": 512,
    "claude-haiku-5-5": 512,
    "claude-sonnet-5": 1024,
    "claude-sonnet-4-6": 1024,
    "claude-haiku-4-5-20251001": 4096,
    "claude-haiku-4-5": 4096,
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
    """A copy of a request body moved to another model, thinking field and all."""
    out = dict(payload)
    out["model"] = model
    if "thinking" in out:
        out["thinking"] = no_thinking(model)
    return out


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
        raise AssertionError("Fable 5.1 has no thinking-off word")
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
    # hand-worked: 30k input + 3k output on Fable 5.1 is $0.30 + $0.15
    assert abs(cost_usd(REVIEWER, {"input_tokens": 30000, "output_tokens": 3000}) - 0.45) < 1e-9
    assert cost_usd("claude-unknown", {"input_tokens": 1}) is None
    for m in PRICES:
        assert m in CACHE_MIN_TOKENS, m
    print("claude_models selftest ok")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
