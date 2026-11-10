#!/usr/bin/env python3
"""
cache_probe.py -- does each cached system prompt really cache?

Sends one small request per cached prompt (county reads, critic, county
stories) twice, built by the jobs' own payload builders so the prefix is the
one they send, and checks that the second call reads what the first wrote
(usage.cache_read_input_tokens > 0). Prints each pair's counts and the usage
table (counts and dollars only) to the job summary.

These are PAID calls (a few cents in all). No test and no schedule runs them.

USAGE
  python3 scripts/cache_probe.py --selftest   # fixtures only, no network
  python3 scripts/cache_probe.py --live       # needs ANTHROPIC_API_KEY; paid
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import claude_models as CM  # noqa: E402


def probe_payloads():
    """One small request per cached system prompt."""
    import atlas_reads
    import critique_briefing
    import county_stories
    out = []
    p = atlas_reads.request_params("probe", CM.CHECKER)
    out.append(("atlas reads", dict(p, max_tokens=16)))
    p = critique_briefing.critic_payload(CM.WRITER, "Reply with the word ok.", cache=True)
    out.append(("critic", dict(p, max_tokens=16)))
    out.append(("county stories", {"model": CM.STORY, "max_tokens": 16, "output_config": {"effort": "low"},
                                   "system": CM.cached_system(county_stories.SYSTEM),
                                   "messages": [{"role": "user", "content": "Reply with the word ok."}]}))
    return out


def live_post(payload):
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
                                 data=json.dumps(payload).encode(),
                                 headers=CM.headers_for(payload, {
                                     "x-api-key": os.environ["ANTHROPIC_API_KEY"],
                                     "anthropic-version": "2023-06-01", "content-type": "application/json"}))
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def run(post=live_post, payloads=None, summary_path=None):
    rows, ok = CM.cache_probe(post, payloads if payloads is not None else probe_payloads())
    for label, model, u1, u2, good in rows:
        print(f"{label} ({model}): first call cache write {int(u1.get('cache_creation_input_tokens') or 0)}, "
              f"second call cache read {int(u2.get('cache_read_input_tokens') or 0)}: {'ok' if good else 'NOT CACHED'}")
    CM.write_usage_summary("Cache probe", [(r[0], r[1], u, False) for r in rows for u in (r[2], r[3])], summary_path)
    return 0 if ok else 1


def selftest():
    import tempfile
    pl = probe_payloads()
    assert [lbl for lbl, _ in pl] == ["atlas reads", "critic", "county stories"]
    for lbl, p in pl:
        assert isinstance(p["system"], list) and p["system"][-1]["cache_control"] == CM.CACHE, lbl
        assert p["max_tokens"] == 16 and "temperature" not in p, lbl
    seen = {}

    def fake(p):
        n = seen[p["model"]] = seen.get(p["model"], 0) + 1
        return {"usage": {"cache_creation_input_tokens": 900 if n == 1 else 0,
                          "cache_read_input_tokens": 0 if n == 1 else 900}}
    sp = os.path.join(tempfile.mkdtemp(), "s.md")
    assert run(fake, pl, sp) == 0 and "Cache probe" in open(sp).read()
    assert run(lambda p: {"usage": {}}, pl[:1], sp) == 1, "a second call that reads no cache fails the probe"
    print("cache_probe selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--live" in sys.argv:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            sys.exit("ANTHROPIC_API_KEY not set")
        sys.exit(run())
    else:
        sys.exit("cache_probe.py makes paid API calls: --live to run it, --selftest for the fixtures")
