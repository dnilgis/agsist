#!/usr/bin/env python3
"""Accuracy passes over site pages, through the Message Batches API.

Each pass is a run with its own record folder on the raw branch (never
deployed): accuracy-pass/<run>/ (the first pass, run "", used accuracy-pass/
itself). Input: <record>/input/bundle.json. One entry per page: the page's
visible text from a browser render plus the trimmed data files it loaded, and
an optional "label" (the page template, so findings can be grouped per
builder). Built outside Actions from a local render.

Options (any mode; the workflow passes them as ACC_RUN, ACC_CAP,
ACC_BUDGET_WITH, ACC_CALIBRATE_FROM): --run NAME picks the record folder. submit also takes
--cap DOLLARS (default 80), --budget-with RUN[,RUN] (runs whose spend counts
against the same cap: their actual cost from results.json, or their worst case
from batch.json while still running) and --calibrate-from RUN (gate on this
run's prompt tokens times that run's measured dollars per prompt token, plus
25%, instead of the worst case).

Modes (run by .github/workflows/accuracy-pass.yml, dispatch only):
  selftest          offline checks of the request builder, parser and cost math
  estimate BUNDLE   counts input tokens (free endpoint) and prints a worst-case cost
  submit BUNDLE     estimate, refuse over the cap, refuse if a batch was already
                    submitted for this run (<record>/batch.json exists), then submit one
                    batch with one request per page and write batch.json
  collect           read batch.json, poll until the batch ends (or the wait runs
                    out), then write results.json: per-page claims plus the
                    actual cost from each result's usage
  report BUNDLE     rank the likely_wrong / likely_outdated claims of results.json
                    into findings.json and findings.md (severity, whether the
                    quote is really on the page, what backs it, template reach,
                    traffic). Leads for a person to check, never page edits.
  sets OUT          build a "sets" bundle: about 3% of every generated page set,
                    stratified by state, each page with the data slice it was built
                    from and the set's reference excerpts (scripts/accuracy_sets.py).
                    estimate, submit, collect and report then run as usual; a sets
                    bundle uses its own prompt (errors only, cause template or
                    page data), no web search, and report ranks set-wide issues first.

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
ROOT = "accuracy-pass"
OUT = ROOT           # set from --run in main()
MAX_SEARCHES = 4
MAX_TOKENS = 32000
COST_CAP = 80.0      # dollars; default for --cap
CALIBRATION_MARGIN = 1.25
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
    if entry.get("set"):
        import accuracy_sets as AS
        return AS.build_params(entry, today, MODEL)
    data = "\n\n".join(f"--- {d['path']} ---\n{d['body']}" for d in entry.get("data", [])) or "(none)"
    params = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "high"},
        # Automatic caching: the web search loop re-reads the whole prompt and
        # every earlier result on each step; with caching on, those re-reads
        # bill as cache reads.
        "cache_control": {"type": "ephemeral"},
        "system": SYSTEM.format(today=today, searches=MAX_SEARCHES, verdicts=", ".join(VERDICTS)),
        "tools": [{"type": "web_search_20260209", "name": "web_search", "max_uses": MAX_SEARCHES}],
        "messages": [{"role": "user", "content": USER.format(
            url=entry["url"], page=entry["page"], title=entry.get("title", ""), meta=entry.get("meta", ""),
            cut=" (CUT: the page text was longer; only the first part is shown)" if entry.get("text_cut") else "",
            text=entry["text"], ld="\n".join(entry.get("ld", []))[:8000] or "(none)", data=data)}],
    }
    if entry.get("label"):
        params["messages"][0]["content"] = f"Template: {entry['label']} (one of many pages built from the same template)\n" + params["messages"][0]["content"]
    return params


def record_dir(run):
    if run and not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,40}", run):
        sys.exit(f"::error::bad run name {run!r} (lowercase letters, digits, dashes)")
    return f"{ROOT}/{run}" if run else ROOT


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
    max_tokens of output, every search used. Priced as if every input token
    were a cache write (caching is on; a write costs more than plain input)
    and no read ever hit."""
    inp = base_tokens * 4 + MAX_SEARCHES * 12000 * 3
    return (inp * PRICE_CACHE_WRITE + MAX_TOKENS * PRICE_OUT) / 1e6 + MAX_SEARCHES * PRICE_SEARCH


def worst_case_of(entry, base_tokens):
    if entry.get("set"):
        import accuracy_sets as AS
        return AS.worst_case(base_tokens, PRICE_CACHE_WRITE, PRICE_OUT)
    return worst_case(base_tokens)


def estimate(bundle, today):
    total = 0.0
    rows = []
    for e in bundle["pages"]:
        p = build_params(e, today)
        try:
            n = json.loads(http("POST", "/messages/count_tokens", {k: p[k] for k in ("model", "system", "tools", "messages", "thinking") if k in p}))["input_tokens"]
        except SystemExit as err:
            print(f"::warning::count_tokens failed for {e['page']} ({err}); using characters / 3", flush=True)
            n = len(json.dumps(p)) // 3
        c = worst_case_of(e, n)
        rows.append({"page": e["page"], "label": e.get("label"), "input_tokens": n, "worst_case_usd": round(c, 3)})
        total += c
        print(f"{e['page']}: {n} input tokens, worst case ${c:.2f}", flush=True)
    print(f"::notice title=Accuracy pass estimate::worst case ${total:.2f} for {len(rows)} requests, "
          f"{sum(r['input_tokens'] for r in rows)} prompt tokens (cap ${COST_CAP:.0f})", flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump({"worst_case_usd": round(total, 2), "prompt_tokens": sum(r["input_tokens"] for r in rows), "rows": rows},
              open(f"{OUT}/estimate.json", "w"), indent=1)
    return total, rows


def spent_by(runs):
    """Dollars already committed by other runs under the same cap."""
    total = 0.0
    for run in runs:
        d = record_dir(run)
        if os.path.exists(f"{d}/results.json"):
            total += json.load(open(f"{d}/results.json"))["actual_cost_usd"]
        elif os.path.exists(f"{d}/batch.json"):
            total += json.load(open(f"{d}/batch.json"))["worst_case_usd"]
        else:
            print(f"::warning::run {run}: no batch.json or results.json; counting $0", flush=True)
    return total


def calibrated(prompt_tokens, run):
    """Projected cost from a finished run with the same settings: its actual
    dollars per prompt token, times this bundle's prompt tokens, plus a margin."""
    d = record_dir(run)
    res, est = json.load(open(f"{d}/results.json")), json.load(open(f"{d}/estimate.json"))
    base = est.get("prompt_tokens") or sum(r["input_tokens"] for r in est["rows"])
    return prompt_tokens * res["actual_cost_usd"] / base * CALIBRATION_MARGIN


def repair_quotes(s):
    """Escape bare double quotes inside JSON strings (a page line such as
    'the "Top bid" row' copied into exact_text unescaped). A quote inside a
    string closes it only when the next non-space character is , } ] or :."""
    out, i, n, ins = [], 0, len(s), False
    while i < n:
        ch = s[i]
        if not ins:
            ins = ch == '"'
            out.append(ch)
        elif ch == "\\":
            out.append(s[i:i + 2]); i += 2; continue
        elif ch == '"':
            j = i + 1
            while j < n and s[j] in " \t\r\n":
                j += 1
            if j >= n or s[j] in ",}]:":
                ins = False
                out.append(ch)
            else:
                out.append('\\"')
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def loads_lenient(s):
    # strict=False lets raw tabs and newlines through (table rows copied from pages)
    try:
        return json.loads(s, strict=False)
    except ValueError:
        return json.loads(repair_quotes(s), strict=False)


def parse_json_block(text):
    blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, re.S)
    for b in reversed(blocks):
        try:
            return loads_lenient(b)
        except ValueError:
            pass
    i = text.rfind('{"page"')
    if i >= 0:
        try:
            return loads_lenient(text[i:text.rfind("}") + 1])
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


def cmd_submit(bundle_path, cap=COST_CAP, budget_with=(), calibrate_from=None):
    if os.path.exists(f"{OUT}/batch.json"):
        sys.exit(f"::error::{OUT}/batch.json already exists (a batch was submitted for this run); not submitting a second one")
    bundle = json.load(open(bundle_path))
    today = bundle.get("today") or time.strftime("%B %-d, %Y")
    total, rows = estimate(bundle, today)
    gate, how = total, "worst case"
    if calibrate_from:
        gate, how = calibrated(sum(r["input_tokens"] for r in rows), calibrate_from), f"calibrated on run {calibrate_from}"
    spent = spent_by(budget_with)
    print(f"::notice title=Accuracy pass gate::{how} ${gate:.2f} + ${spent:.2f} already spent by {list(budget_with)} vs cap ${cap:.2f}", flush=True)
    if gate + spent > cap:
        sys.exit(f"::error::estimate ${gate:.2f} ({how}) plus ${spent:.2f} spent is over the ${cap:.2f} cap; not submitting")
    reqs = [{"custom_id": custom_id(e["page"]), "params": build_params(e, today)} for e in bundle["pages"]]
    assert len({r["custom_id"] for r in reqs}) == len(reqs), "custom_id collision"
    b = json.loads(http("POST", "/messages/batches", {"requests": reqs}, timeout=300))
    rec = {"batch_id": b["id"], "submitted_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "model": MODEL, "requests": len(reqs), "pages": {custom_id(e["page"]): e["page"] for e in bundle["pages"]},
           "labels": {custom_id(e["page"]): e.get("label") for e in bundle["pages"]},
           "worst_case_usd": round(total, 2), "gate_usd": round(gate, 2), "gate": how, "cap_usd": cap,
           "spent_before_usd": round(spent, 2)}
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
        entry = {"page": rec["pages"].get(cid, cid), "label": (rec.get("labels") or {}).get(cid), "result": res["type"]}
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
    errors = 0
    for e in pages.values():
        for c in (e.get("parsed") or {}).get("claims", []):
            counts[c.get("verdict")] = counts.get(c.get("verdict"), 0) + 1
        errors += len((e.get("parsed") or {}).get("errors") or [])     # sets bundles
    out = {"batch_id": bid, "model": rec["model"], "actual_cost_usd": round(cost, 2), "tokens": tok,
           "verdict_counts": counts, "claims_total": sum(counts.values()), "errors_total": errors,
           "results": {k: pages[k]["result"] for k in pages}, "pages": pages}
    json.dump(out, open(f"{OUT}/results.json", "w"), indent=1)
    print(f"::notice title=Accuracy pass results::actual cost ${cost:.2f}; claims {sum(counts.values())}; {counts}; errors {errors}", flush=True)


# ---- report: rank the leads (likely_wrong / likely_outdated) into findings.json + findings.md ----
SEV = {"high": 3, "medium": 2, "low": 1}
LEAD_VERDICTS = ("likely_wrong", "likely_outdated")


def _squash(s):
    return re.sub(r"\s+", " ", (s or "").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')).strip().lower()


def lead_score(lead):
    """Higher first. Severity leads; then how solid the evidence looks from the
    outside (the quote is really on the page; a cited source was in the
    model's own results or the evidence names a data file); then reach (pages
    built from the same template) and traffic. A lead is a question for a
    person, not a finding: nothing here decides that a page is wrong."""
    sev = SEV.get(lead.get("severity"), 1)
    ev = (1.0 if lead["quote_on_page"] else 0.4) * (1.0 if lead["backed_by"] != "none" else 0.6)
    reach = lead.get("reach") or 1
    traffic = lead.get("traffic_score") or 0
    return round(sev * 10 * ev + min(reach, 3000) ** 0.5 / 10 + traffic * 20, 3)


def build_report(results, bundle):
    by_page = {e["page"]: e for e in bundle.get("pages", [])}
    leads, seen = [], set()
    for cid, e in results["pages"].items():
        b = by_page.get(e["page"], {})
        hay = _squash(b.get("text", "") + " " + " ".join(b.get("ld", [])) + " " + b.get("title", "") + " " + b.get("meta", ""))
        for c in (e.get("parsed") or {}).get("claims", []):
            if c.get("verdict") not in LEAD_VERDICTS:
                continue
            key = (e["page"], _squash(c.get("exact_text"))[:200])
            if key in seen:
                continue
            seen.add(key)
            q = _squash(c.get("exact_text"))
            ev = (c.get("evidence") or "")
            backed = ("source" if c.get("source_url") and c.get("source_seen_in_results")
                      else "data" if re.search(r"/data/|builder input|\.json|the page itself|arithmetic|math|sum", ev, re.I)
                      else "none")
            lead = {"page": e["page"], "url": b.get("url"), "label": e.get("label") or b.get("label"),
                    "reach": b.get("reach", 1), "traffic_rank": b.get("traffic_rank"), "traffic_score": b.get("traffic_score", 0),
                    "verdict": c.get("verdict"), "severity": c.get("severity") or "low",
                    "exact_text": c.get("exact_text"), "claim": c.get("claim"), "correct_value": c.get("correct_value"),
                    "suggested_fix": c.get("suggested_fix"), "evidence": ev, "source_url": c.get("source_url"),
                    "source_seen_in_results": bool(c.get("source_seen_in_results")),
                    "quote_on_page": bool(q) and q[:160] in hay, "backed_by": backed}
            if c.get("source_url") and not c.get("source_seen_in_results"):
                lead["flag"] = "cited URL was not in the model's own search results"
            lead["score"] = lead_score(lead)
            leads.append(lead)
    leads.sort(key=lambda x: (-x["score"], x["page"]))
    for i, l in enumerate(leads):
        l["rank"] = i + 1
    problems = {k: v.get("result") if v.get("result") != "succeeded" else v.get("stop_reason")
                for k, v in results["pages"].items()
                if v.get("result") != "succeeded" or v.get("stop_reason") != "end_turn" or not v.get("parsed")}
    rep = {"batch_id": results.get("batch_id"), "model": results.get("model"), "actual_cost_usd": results.get("actual_cost_usd"),
           "pages": len(results["pages"]), "claims_total": results.get("claims_total"), "verdict_counts": results.get("verdict_counts"),
           "leads": len(leads), "pages_without_a_parsed_answer": problems,
           "how_ranked": "severity x evidence (quote found on the page; source seen in the model's own search results or a data file named) "
                         "+ template reach + traffic. Leads are not findings: check each against the repo and the references branch before a fix.",
           "findings": leads}
    md = [f"# Accuracy pass leads, ranked ({results.get('batch_id')})", "",
          f"Model {results.get('model')}, {len(results['pages'])} pages, {results.get('claims_total')} claims, "
          f"actual cost ${results.get('actual_cost_usd')}. Verdicts: {results.get('verdict_counts')}.", "",
          "These are leads, not findings. Each one needs a check against the page's data, its builder and the references branch "
          "before anything changes. `quote` = the exact text was found on the rendered page; `backed` = what the model leaned on.", ""]
    if problems:
        md += ["Pages with no usable answer (rerun or read results-raw.jsonl): " + ", ".join(f"{k} ({v})" for k, v in problems.items()), ""]
    md += ["| # | sev | page (template, pages) | text on the page | correct value / evidence | backed | quote |", "|---|---|---|---|---|---|---|"]
    cell = lambda s, n=300: (s or "").replace("|", "/").replace("\n", " ")[:n]
    for l in leads:
        where = l["page"] + (f" ({l['label']}, {l['reach']})" if l.get("label") else "") + (f" [traffic #{l['traffic_rank']}]" if l.get("traffic_rank") else "")
        md.append(f"| {l['rank']} | {l['severity']} {l['verdict'].replace('likely_', '')} | {cell(where)} | {cell(l['exact_text'], 220)} | "
                  f"{cell(l['correct_value'], 200)}. {cell(l['evidence'], 300)}{' ' + l['source_url'] if l.get('source_url') else ''}"
                  f"{' (' + l['flag'] + ')' if l.get('flag') else ''} | {l['backed_by']} | {'yes' if l['quote_on_page'] else 'NO'} |")
    return rep, "\n".join(md) + "\n"


def cmd_report(bundle_path):
    res_path = f"{OUT}/results.json"
    if not os.path.exists(res_path):
        print(f"no {res_path}; nothing to rank", flush=True)
        return
    bundle = json.load(open(bundle_path))
    if bundle.get("mode") == "sets":
        import accuracy_sets as AS
        rep, md = AS.build_report(json.load(open(res_path)), bundle)
        json.dump(rep, open(f"{OUT}/findings.json", "w"), indent=1)
        open(f"{OUT}/findings.md", "w").write(md)
        print(f"::notice title=Accuracy sets leads::{rep['issues']} issues ({rep['setwide_issues']} set-wide) from "
              f"{rep['errors_total']} flags ranked into {OUT}/findings.json and findings.md", flush=True)
        return
    rep, md = build_report(json.load(open(res_path)), bundle)
    json.dump(rep, open(f"{OUT}/findings.json", "w"), indent=1)
    open(f"{OUT}/findings.md", "w").write(md)
    hi = sum(1 for l in rep["findings"] if l["severity"] == "high")
    print(f"::notice title=Accuracy pass leads::{rep['leads']} leads ({hi} high) ranked into {OUT}/findings.json and findings.md", flush=True)


def selftest():
    global ROOT
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
    assert p["cache_control"] == {"type": "ephemeral"}
    e["label"] = "rent-state"
    assert build_params(e, "x")["messages"][0]["content"].startswith("Template: rent-state")
    assert record_dir("") == ROOT and record_dir("run2-templates") == ROOT + "/run2-templates"
    # bare quotes and raw tabs inside strings
    bad = '{"page": "a", "claims": [{"exact_text": "the "Top bid" row\tx", "verdict": "likely_wrong"}], "notes": "n"}'
    got = parse_json_block("```json\n" + bad + "\n```")
    assert got and got["claims"][0]["exact_text"] == 'the "Top bid" row\tx', got
    assert loads_lenient('{"a": "say \\"hi\\"", "b": ["x", "y"]}') == {"a": 'say "hi"', "b": ["x", "y"]}
    # cap bookkeeping across runs, in a scratch folder
    import tempfile
    keep, ROOT = ROOT, tempfile.mkdtemp()
    try:
        os.makedirs(f"{ROOT}/ra"); os.makedirs(f"{ROOT}/rb")
        json.dump({"actual_cost_usd": 10.0}, open(f"{ROOT}/ra/results.json", "w"))
        json.dump({"prompt_tokens": 1_000_000, "rows": []}, open(f"{ROOT}/ra/estimate.json", "w"))
        json.dump({"worst_case_usd": 7.5}, open(f"{ROOT}/rb/batch.json", "w"))
        assert spent_by(["ra", "rb"]) == 17.5
        assert abs(calibrated(500_000, "ra") - 10.0 * 0.5 * CALIBRATION_MARGIN) < 1e-9
    finally:
        ROOT = keep
    # report ranking
    res = {"batch_id": "b", "model": MODEL, "actual_cost_usd": 1.0, "claims_total": 3, "verdict_counts": {}, "pages": {
        "a": {"page": "rent/iowa.html", "result": "succeeded", "stop_reason": "end_turn", "parsed": {"claims": [
            {"exact_text": "Corn is  $4.10.", "verdict": "likely_wrong", "severity": "medium", "evidence": "/data/x.json says 4.20"},
            {"exact_text": "Not on the page", "verdict": "likely_wrong", "severity": "medium", "evidence": "guess", "source_url": "https://n.example", "source_seen_in_results": False},
            {"exact_text": "Corn is $4.10.", "verdict": "likely_wrong", "severity": "medium", "evidence": "dup"},
            {"exact_text": "x", "verdict": "supported_by_data"}]}},
        "b": {"page": "x.html", "result": "errored"}}}
    rep, md = build_report(res, {"pages": [dict(e, reach=48, traffic_score=0.01)]})
    assert rep["leads"] == 2 and rep["findings"][0]["exact_text"] == "Corn is  $4.10." and rep["findings"][0]["quote_on_page"]
    assert rep["findings"][1]["quote_on_page"] is False and rep["findings"][1]["backed_by"] == "none" and "flag" in rep["findings"][1]
    assert rep["findings"][0]["score"] > rep["findings"][1]["score"] and "b" in rep["pages_without_a_parsed_answer"]
    assert "| 1 | medium wrong | rent/iowa.html" in md
    sets_selftest()
    print("selftest ok")


def sets_selftest():
    """The sets mode: sampler, slicer, request shape, cost bound, collect count, set-wide ranking."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import accuracy_sets as AS
    items = [(f"rain/{s}/c{i}.html", "") for s, n in (("iowa", 99), ("texas", 254), ("delaware", 3)) for i in range(n)]
    pick = AS.sample(items, "county")
    assert len(pick) == 11 and pick == AS.sample(items, "county"), pick                # ceil(3% of 356), same every run
    by = {s: sum(1 for p, _ in pick if f"/{s}/" in p) for s in ("iowa", "texas", "delaware")}
    assert by["texas"] > by["iowa"] >= 2 and sum(by.values()) == 11, by
    assert len(AS.sample(items[:5], "county")) == 3 and len(AS.sample(items[:2], "county")) == 2
    raw = ('<html><head><title>Story County, IA</title><meta name="description" content="d">'
           '<link rel="canonical" href="https://agsist.com/rain/iowa/story-county">'
           '<script type="application/ld+json">{"@type":"Dataset"}</script></head><body><nav>Menu Corn Soybeans</nav>'
           '<h1 data-fips="19169">Story County, Iowa rain</h1><p>27.61 in since Jan 1</p><script>var x=1</script></body></html>')
    title, meta, canon, text, ld, stub = AS.page_text(raw)
    assert title == "Story County, IA" and "27.61 in" in text and "Menu" not in text and "var x" not in text and not stub
    assert ld == ['{"@type":"Dataset"}'] and canon.endswith("story-county")
    assert AS.page_text('<meta http-equiv="refresh" content="0; url=/x">')[5]
    ids = AS.ids_of("county", "rain/iowa/story-county.html", raw, title)
    assert ids["ST"] == "IA" and ids["fips"] == "19169" and ids["county"] == "Story County", ids
    assert AS.ids_of("town", "cash-bids/illinois/ashton.html", "<h1>Cash grain bids in Ashton, IL today</h1>", "")["town"] == "Ashton"
    assert AS.ids_of("company", "cash-bids/company/adm.html", "<h1>ADM cash grain bids today</h1>", "")["company"] == "ADM"
    assert AS.ids_of("date", "hail/2022-05-01.html", "", "")["year"] == "2022"
    data = {"edate": "2026-10-13", "counties": {"19169": {"acc": 1, "cum": list(range(400))},
                                                 **{str(19000 + i): {"acc": i, "cum": list(range(400))} for i in range(1, 60, 2)}}}
    strong, keys = AS.needles(ids)
    sl = AS.slice_json(data, strong, keys, 3000)
    assert "19169" in sl["counties"] and "19001" not in sl["counties"] and "_omitted" in sl["counties"] and sl["edate"] == "2026-10-13", sl.keys()
    rows = {"st": "IA", "c": [{"f": "19169", "n": "Story"}] + [{"f": str(19200 + i), "n": "x" * 50} for i in range(1, 200, 2)]}
    sl2 = AS.slice_json(rows, strong, keys, 2000)
    assert sl2["c"][0]["f"] == "19169" and len(sl2["c"]) == 2 and "other rows" in sl2["c"][1]["_omitted"]
    e = {"set": "rain-county", "label": "rain-county", "reach": 2691, "page": "rain/iowa/story-county.html",
         "url": canon, "title": title, "meta": meta, "text": text, "ld": ld, "ids": ids,
         "data": [{"path": "data/rain/ia.json", "body": json.dumps(sl)}], "refs": "[ncei-normals-1991-2020]\nNormals"}
    p = build_params(e, "October 18, 2026")
    assert p["model"] == MODEL and "tools" not in p and p["max_tokens"] == AS.MAX_TOKENS and "budget_tokens" not in json.dumps(p)
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"} and "rain-county (2691 pages" in p["system"][0]["text"]
    assert "ncei-normals" in p["system"][0]["text"] and "data/rain/ia.json" in p["messages"][0]["content"]
    assert "\u2014" not in AS.SYSTEM and "\u2014" not in AS.USER
    # the measured bundle (Oct 18, 2026): 443 pages, about 25k characters (under 9k tokens) each, under a $40 cap at the worst case
    assert 450 * worst_case_of(e, 9000) < 40 and worst_case_of(e, 9000) < worst_case_of({}, 9000)
    # set-wide ranking: the same template mistake on two pages outranks a one-page data slip
    mk = lambda page, fips, county, errs: (page, {"page": page, "set": "rain-county", "text": text + " Normal is 1991-2020", "ld": [], "title": "", "meta": "",
                                                  "ids": {"ST": "IA", "fips": fips, "county": county}}, errs)
    pg = [mk("rain/iowa/story-county.html", "19169", "Story County", [
              {"exact_text": "27.61 in since Jan 1", "problem": "Story County total does not match the data acc value 2761",
               "evidence": "data/rain/ia.json counties.19169.acc = 2761", "data_path": "x", "cause": "page_data", "severity": "medium"},
              {"exact_text": "Normal is 1991-2020", "problem": "normals period label says 1991-2020 but data uses 1981-2010 normals",
               "evidence": "data/rain/ia.json normals_period", "data_path": "y", "cause": "unclear", "severity": "low"}]),
          mk("rain/iowa/boone-county.html", "19015", "Boone County", [
              {"exact_text": "Normal is 1991-2020", "problem": "normals period label says 1991-2020 but data uses 1981-2010 normals",
               "evidence": "data/rain/ia.json normals_period", "data_path": "y", "cause": "unclear", "severity": "low"}])]
    res = {"batch_id": "b", "model": MODEL, "actual_cost_usd": 1.0, "pages": {
        custom_id(pg_): {"page": pg_, "label": "rain-county", "result": "succeeded", "stop_reason": "end_turn", "parsed": {"errors": errs}}
        for pg_, _, errs in pg}}
    res["pages"]["x"] = {"page": "rain/iowa/x.html", "result": "succeeded", "stop_reason": "max_tokens", "parsed": None}
    bun = {"mode": "sets", "sets": {"rain-county": {"pages": 2691, "sampled": 81, "refs": []}}, "pages": [b_ for _, b_, _ in pg]}
    rep, md = AS.build_report(res, bun)
    top = rep["issues_ranked"][0]
    assert top["setwide"] and top["pages_flagging"] == 2 and "1981-2010" in top["problem"], top
    assert rep["issues_ranked"][1]["setwide"] is False and rep["issues_ranked"][1]["quote_on_page" if False else "evidence_solid_share"] == 1.0
    assert rep["errors_total"] == 3 and rep["issues"] == 2 and "x" in rep["pages_without_a_parsed_answer"]
    assert md.index("Set-wide issues") < md.index("Single-page issues") and "| rain-county | 2691 | 81 | 2 | 2 | 1 |" in md, md


def take(args, flag, default=None):
    if flag in args:
        i = args.index(flag)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


if __name__ == "__main__":
    a = sys.argv[1:]
    env = os.environ.get
    run = take(a, "--run", env("ACC_RUN", ""))
    cap = float(take(a, "--cap", env("ACC_CAP") or str(COST_CAP)))
    budget_with = [x.strip() for x in take(a, "--budget-with", env("ACC_BUDGET_WITH", "")).split(",") if x.strip()]
    calibrate_from = take(a, "--calibrate-from", env("ACC_CALIBRATE_FROM") or None)
    OUT = record_dir(run)
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "estimate":
        b = json.load(open(a[1])); estimate(b, b.get("today") or time.strftime("%B %-d, %Y"))
    elif a[0] == "submit":
        cmd_submit(a[1], cap, budget_with, calibrate_from)
    elif a[0] == "collect":
        cmd_collect(int(a[1]) if len(a) > 1 else 0)
    elif a[0] == "report":
        cmd_report(a[1])
    elif a[0] == "sets":
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import accuracy_sets as AS
        AS.main(a[1:])
    else:
        sys.exit("modes: selftest | estimate BUNDLE | submit BUNDLE | collect [WAIT_MINUTES] | report BUNDLE | sets OUT  [--run NAME] [--cap N] [--budget-with RUNS] [--calibrate-from RUN]")
