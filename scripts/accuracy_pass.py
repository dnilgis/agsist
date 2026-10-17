#!/usr/bin/env python3
"""One-time accuracy pass over the most-visited pages, through the Message Batches API.

Input: accuracy-pass/input/bundle.json on the raw branch (never deployed). One
entry per page: the page's visible text from a browser render plus the trimmed
data files it loaded. Built outside Actions from a local render.

Modes (run by .github/workflows/accuracy-pass.yml, dispatch only):
  selftest          offline checks of the request builder, parser and cost math
  estimate BUNDLE   counts input tokens (free endpoint) and prints a worst-case cost
  submit BUNDLE     estimate, refuse over the cap, refuse if a batch was already
                    submitted (accuracy-pass/batch.json exists), then submit one
                    batch with one request per page and write batch.json
  collect           read batch.json, poll until the batch ends (or the wait runs
                    out), then write results.json: per-page claims plus the
                    actual cost from each result's usage

Every output lands in accuracy-pass/ and goes to the raw branch through
scripts/push_raw.sh. Nothing here touches a page.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = "https://api.anthropic.com/v1"
MODEL = "claude-opus-5-5"
OUT = "accuracy-pass"
MAX_SEARCHES = 5
MAX_TOKENS = 32000
COST_CAP = 80.0      # dollars; submit refuses above this worst-case estimate
# Claude Opus 5.5 list prices per million tokens, halved for the Batches API.
PRICE_IN = 4.00 / 2
PRICE_OUT = 20.00 / 2
PRICE_CACHE_WRITE = 4.00 * 1.25 / 2
PRICE_CACHE_READ = 0.20 / 2
PRICE_SEARCH = 10.00 / 1000   # per web search, not discounted

VERDICTS = ["supported_by_data", "supported_by_source", "likely_outdated", "likely_wrong", "unverifiable"]

SYSTEM = """You are checking a farm website, agsist.com, for factual accuracy. Today is {today}.

You get one page: its visible text as a reader sees it after the page loads, and the data files the page loaded (trimmed; a long list keeps its first rows and says how many it had). Prices, bids and weather on the page come from those data files at the moment of the render.

Your job: list every factual claim on the page and give each one a verdict.
- A factual claim is anything a reader could check: a number, a date, a rule, a program detail, a deadline, a rate, a definition, a "USDA says", a formula, a historical fact. Skip opinions, navigation, button labels and marketing lines. When a table or list repeats the same kind of row (one per county, per day, per elevator), treat the table as one claim and spot-check a few rows against the data.
- Verdicts:
  supported_by_data: the claim matches the provided data files (a live price that matches the data is correct, even if today's market is different).
  supported_by_source: an outside source you actually read in a search result confirms it. Give that result's URL.
  likely_outdated: it was true once but a newer figure, rule or date replaces it.
  likely_wrong: the data or a source you read contradicts it, or the arithmetic does not work.
  unverifiable: you could not confirm or refute it with the data and your searches.
- You may run up to {searches} web searches. Spend them on the claims most likely to be wrong or out of date: program rules, deadlines, rates, report dates, published statistics. Do not search for live prices.
- Never invent a source. A source_url must be a URL that appeared in your own search results in this conversation. If you did not read a source, the verdict cannot be supported_by_source.
- Check the arithmetic in any worked example or formula the page shows.
- "exact_text" must be copied character for character from the page text, short (one sentence or a table row), so it can be found with a text search.
- For likely_outdated and likely_wrong, give the correct value and a suggested fix in plain words.

Finish with one JSON object in a ```json fenced block and nothing after it:
{{"page": "<path>", "claims": [{{"exact_text": "...", "claim": "<the claim in your words>", "verdict": "<one of: {verdicts}>", "evidence": "<what you checked: which data field, which source, the math>", "source_url": "<url or null>", "correct_value": "<or null>", "suggested_fix": "<or null>", "severity": "high|medium|low"}}], "notes": "<anything a reviewer should know, such as text that was cut off>"}}
Severity: high means a reader could lose money or miss a deadline acting on it; medium means a wrong figure; low means wording or a minor detail."""

USER = """Page: {url}  (file {page})
Title: {title}
Meta description: {meta}

=== VISIBLE PAGE TEXT{cut} ===
{text}

=== STRUCTURED DATA (JSON-LD) ===
{ld}

=== DATA FILES THE PAGE LOADED (trimmed) ===
{data}"""


def build_params(entry, today):
    data = "\n\n".join(f"--- {d['path']} ---\n{d['body']}" for d in entry.get("data", [])) or "(none)"
    params = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
        "system": SYSTEM.format(today=today, searches=MAX_SEARCHES, verdicts=", ".join(VERDICTS)),
        "tools": [{"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_SEARCHES}],
        "messages": [{"role": "user", "content": USER.format(
            url=entry["url"], page=entry["page"], title=entry.get("title", ""), meta=entry.get("meta", ""),
            cut=" (CUT: the page text was longer; only the first part is shown)" if entry.get("text_cut") else "",
            text=entry["text"], ld="\n".join(entry.get("ld", []))[:8000] or "(none)", data=data)}],
    }
    return params


def custom_id(page):
    return re.sub(r"[^a-zA-Z0-9_-]", "_", page)[:64]


def http(method, path, body=None, timeout=120):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        sys.exit("::error::ANTHROPIC_API_KEY not set")
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                                          "content-type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode()
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:800]
            if e.code in (429, 500, 502, 503, 529) and attempt < 3:
                time.sleep(20 * (attempt + 1)); continue
            sys.exit(f"::error::{method} {path} HTTP {e.code}: {msg}")
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(20); continue
            sys.exit(f"::error::{method} {path}: {e}")


def cost_of(usage):
    """Dollars for one result's usage at batch prices."""
    srv = usage.get("server_tool_use") or {}
    return (usage.get("input_tokens", 0) * PRICE_IN
            + usage.get("cache_creation_input_tokens", 0) * PRICE_CACHE_WRITE
            + usage.get("cache_read_input_tokens", 0) * PRICE_CACHE_READ
            + usage.get("output_tokens", 0) * PRICE_OUT) / 1e6 + srv.get("web_search_requests", 0) * PRICE_SEARCH


def worst_case(base_tokens):
    """Upper bound for one request: the prompt read about four times over the
    server tool loop, plus up to 12k tokens of search results per search, full
    max_tokens of output, every search used."""
    inp = base_tokens * 4 + MAX_SEARCHES * 12000 * 3
    return (inp * PRICE_IN + MAX_TOKENS * PRICE_OUT) / 1e6 + MAX_SEARCHES * PRICE_SEARCH


def estimate(bundle, today):
    total = 0.0
    rows = []
    for e in bundle["pages"]:
        p = build_params(e, today)
        try:
            n = json.loads(http("POST", "/messages/count_tokens", {k: p[k] for k in ("model", "system", "tools", "messages", "thinking")}))["input_tokens"]
        except SystemExit as err:
            print(f"::warning::count_tokens failed for {e['page']} ({err}); using characters / 3", flush=True)
            n = len(json.dumps(p)) // 3
        c = worst_case(n)
        rows.append({"page": e["page"], "input_tokens": n, "worst_case_usd": round(c, 3)})
        total += c
        print(f"{e['page']}: {n} input tokens, worst case ${c:.2f}", flush=True)
    print(f"::notice title=Accuracy pass estimate::worst case ${total:.2f} for {len(rows)} requests, "
          f"{sum(r['input_tokens'] for r in rows)} prompt tokens (cap ${COST_CAP:.0f})", flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump({"worst_case_usd": round(total, 2), "rows": rows}, open(f"{OUT}/estimate.json", "w"), indent=1)
    return total, rows


def parse_json_block(text):
    blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, re.S)
    for b in reversed(blocks):
        try:
            return json.loads(b)
        except ValueError:
            pass
    i = text.rfind('{"page"')
    if i >= 0:
        try:
            return json.loads(text[i:text.rfind("}") + 1])
        except ValueError:
            pass
    return None


def summarize_message(msg):
    text = "".join(b.get("text", "") for b in msg.get("content", []) if b.get("type") == "text")
    urls = set()
    for b in msg.get("content", []):
        if b.get("type") == "web_search_tool_result" and isinstance(b.get("content"), list):
            urls.update(r.get("url") for r in b["content"] if r.get("url"))
        for c in b.get("citations") or []:
            if c.get("url"):
                urls.add(c["url"])
    parsed = parse_json_block(text)
    if parsed:
        for c in parsed.get("claims", []):
            u = c.get("source_url")
            # A cited URL the model never saw in its own results is flagged, not trusted.
            c["source_seen_in_results"] = bool(u) and (u in urls or any(u.rstrip("/") == x.rstrip("/") for x in urls))
    return parsed, text, sorted(urls)


def cmd_submit(bundle_path):
    if os.path.exists(f"{OUT}/batch.json"):
        sys.exit(f"::error::{OUT}/batch.json already exists (a batch was submitted); not submitting a second one")
    bundle = json.load(open(bundle_path))
    today = bundle.get("today") or time.strftime("%B %-d, %Y")
    total, rows = estimate(bundle, today)
    if total > COST_CAP:
        sys.exit(f"::error::worst-case estimate ${total:.2f} is over the ${COST_CAP:.0f} cap; not submitting")
    reqs = [{"custom_id": custom_id(e["page"]), "params": build_params(e, today)} for e in bundle["pages"]]
    assert len({r["custom_id"] for r in reqs}) == len(reqs), "custom_id collision"
    b = json.loads(http("POST", "/messages/batches", {"requests": reqs}, timeout=300))
    rec = {"batch_id": b["id"], "submitted_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "model": MODEL, "requests": len(reqs), "pages": {custom_id(e["page"]): e["page"] for e in bundle["pages"]},
           "worst_case_usd": round(total, 2)}
    json.dump(rec, open(f"{OUT}/batch.json", "w"), indent=1)
    print(f"::notice title=Accuracy pass submitted::batch {b['id']} with {len(reqs)} requests", flush=True)


def cmd_collect(wait_min):
    rec = json.load(open(f"{OUT}/batch.json"))
    bid = rec["batch_id"]
    deadline = time.time() + wait_min * 60
    while True:
        b = json.loads(http("GET", f"/messages/batches/{bid}"))
        print(f"{bid}: {b['processing_status']} {b.get('request_counts')}", flush=True)
        if b["processing_status"] == "ended" or time.time() > deadline:
            break
        time.sleep(120)
    json.dump(b, open(f"{OUT}/batch-status.json", "w"), indent=1)
    if b["processing_status"] != "ended":
        print("not ended yet; dispatch collect again later", flush=True)
        return
    raw = http("GET", f"/messages/batches/{bid}/results", timeout=600)
    open(f"{OUT}/results-raw.jsonl", "w").write(raw)
    pages, cost, tok = {}, 0.0, {"input": 0, "cache_write": 0, "cache_read": 0, "output": 0, "searches": 0}
    for line in raw.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        cid, res = r["custom_id"], r["result"]
        entry = {"page": rec["pages"].get(cid, cid), "result": res["type"]}
        if res["type"] == "succeeded":
            m = res["message"]
            u = m.get("usage", {})
            entry["usage"] = u
            entry["cost_usd"] = round(cost_of(u), 4)
            cost += cost_of(u)
            tok["input"] += u.get("input_tokens", 0); tok["output"] += u.get("output_tokens", 0)
            tok["cache_write"] += u.get("cache_creation_input_tokens", 0); tok["cache_read"] += u.get("cache_read_input_tokens", 0)
            tok["searches"] += (u.get("server_tool_use") or {}).get("web_search_requests", 0)
            entry["stop_reason"] = m.get("stop_reason")
            parsed, text, urls = summarize_message(m)
            entry["parsed"] = parsed
            entry["search_urls"] = urls
            if not parsed:
                entry["text"] = text[-20000:]
        else:
            entry["error"] = res.get("error")
        pages[cid] = entry
    counts = {v: 0 for v in VERDICTS}
    for e in pages.values():
        for c in (e.get("parsed") or {}).get("claims", []):
            counts[c.get("verdict")] = counts.get(c.get("verdict"), 0) + 1
    out = {"batch_id": bid, "model": rec["model"], "actual_cost_usd": round(cost, 2), "tokens": tok,
           "verdict_counts": counts, "claims_total": sum(counts.values()),
           "results": {k: pages[k]["result"] for k in pages}, "pages": pages}
    json.dump(out, open(f"{OUT}/results.json", "w"), indent=1)
    print(f"::notice title=Accuracy pass results::actual cost ${cost:.2f}; claims {sum(counts.values())}; {counts}", flush=True)


def selftest():
    e = {"page": "rent/iowa.html", "url": "https://agsist.com/rent/iowa", "title": "t", "text": "Corn is $4.10.",
         "data": [{"path": "/data/x.json", "body": "{}"}], "ld": []}
    p = build_params(e, "October 17, 2026")
    assert p["model"] == MODEL and p["tools"][0]["max_uses"] == MAX_SEARCHES
    assert "budget_tokens" not in json.dumps(p) and "tool_choice" not in p
    assert "/data/x.json" in p["messages"][0]["content"]
    assert custom_id("cash-bids/missouri/deerfield.html") == "cash-bids_missouri_deerfield_html"
    t = 'notes\n```json\n{"page": "a", "claims": [{"exact_text": "x", "verdict": "likely_wrong", "source_url": "https://u.example/a"}]}\n```'
    msg = {"content": [{"type": "web_search_tool_result", "content": [{"url": "https://u.example/a"}]}, {"type": "text", "text": t}]}
    parsed, _, urls = summarize_message(msg)
    assert parsed["claims"][0]["source_seen_in_results"] is True and urls == ["https://u.example/a"]
    msg["content"][0]["content"] = [{"url": "https://other.example"}]
    assert summarize_message(msg)[0]["claims"][0]["source_seen_in_results"] is False
    assert abs(cost_of({"input_tokens": 1_000_000, "output_tokens": 100_000, "server_tool_use": {"web_search_requests": 5}}) - (2.0 + 1.0 + 0.05)) < 1e-9
    assert worst_case(20000) < 2.0
    print("selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "estimate":
        b = json.load(open(a[1])); estimate(b, b.get("today") or time.strftime("%B %-d, %Y"))
    elif a[0] == "submit":
        cmd_submit(a[1])
    elif a[0] == "collect":
        cmd_collect(int(a[1]) if len(a) > 1 else 0)
    else:
        sys.exit("modes: selftest | estimate BUNDLE | submit BUNDLE | collect [WAIT_MINUTES]")
