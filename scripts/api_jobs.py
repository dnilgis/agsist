#!/usr/bin/env python3
"""Two one-time review jobs through the Message Batches API.

  search  For each page, the page's first screen of text (desktop and phone,
          from a browser render) plus the top 30 real search terms that land on
          it. The model says whether the first screen answers each term and
          what is missing.
  alt     For each image on the hand-made pages, the image plus its
          surrounding text. The model proposes plain alt text.
  story   For each county rain page, the facts the page states (built by
          scripts/county_stories.py, in Actions, from data/rain). The model
          writes 2 to 4 plain sentences; county_stories.py collect checks every
          claim against the facts before anything reaches a page. The same for
          the PRF county, Farmland Atlas county, town cash bid and co-op
          company pages: rows that carry "set" (scripts/stories_core.py).
  elevsite For each unread elevator company, the saved copies of its own
          site (captured by the bids repo, scripts/elevsites_job.py bundle).
          The model says whether it posts cash bids, where, and on what
          platform; elevsites_job.py collect checks each answer against the
          saved pages and writes a ranked to-do. Sonnet, not Opus: naming the
          vendor from script and frame hosts and spotting a bid table is
          plain reading, and every answer is checked against the copy anyway.

Input: apijobs/<run>/input/bundle.json on the raw branch (never deployed),
built outside Actions from a local render. Every output lands in
apijobs/<run>/ and goes back to raw through scripts/push_raw.sh.

Modes (run by .github/workflows/api-jobs.yml, dispatch only):
  selftest          offline checks of the request builder, parser and cost math
  estimate BUNDLE   count input tokens (free endpoint), write a worst-case cost
  submit BUNDLE     estimate, refuse over the cap, refuse if this run already
                    has a batch record (apijobs/<run>/batch.json), submit one
                    batch, write the record
  collect           read the record, poll until the batch ends (or the wait
                    runs out), write results.json with per-job actual cost

APIJOBS_RUN names the run folder (default r1). A record is written the moment
the batch is accepted, and submit refuses when one exists, so a run is never
submitted twice. Nothing here touches a page.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = "https://api.anthropic.com/v1"
MODEL = "claude-sonnet-5-5"            # search and alt
STORY_MODEL = "claude-opus-5-5"        # county stories (Sig, Oct 17)
RUN = re.sub(r"[^a-zA-Z0-9_-]", "", os.environ.get("APIJOBS_RUN", "r1")) or "r1"
OUT = f"apijobs/{RUN}"
COST_CAP = 20.0      # dollars, search and alt together; submit refuses above the worst case
STORY_CAP = 45.0     # dollars, county stories (Sig: well under $50); added when a bundle has stories
ELEVSITE_CAP = 35.0  # dollars, the unread elevators' sites (Sig, Oct 18: capped at $35)
MAX_TOKENS = {"search": 12000, "alt": 3000, "story": 1000, "elevsite": 2500}
SET_STORY_MAX_TOKENS = 700   # the other story sets: a story is about 150 tokens; 700 keeps a 3,070-page batch under STORY_CAP
EFFORT = {"search": "medium", "alt": "low", "story": "low", "elevsite": "low"}
KINDS = ("search", "alt", "story", "elevsite")
# Claude Sonnet 5.5 list prices per million tokens, halved for the Batches API.
PRICE_IN = 2.00 / 2
PRICE_OUT = 10.00 / 2
PRICE_CACHE_WRITE = 2.00 * 1.25 / 2
PRICE_CACHE_READ = 0.20 / 2
# Claude Opus 5.5 ($4 in, $20 out, cache read $0.20 per million), halved for the Batches API.
PRICES = {MODEL: (PRICE_IN, PRICE_OUT, PRICE_CACHE_WRITE, PRICE_CACHE_READ),
          STORY_MODEL: (4.00 / 2, 20.00 / 2, 4.00 * 1.25 / 2, 0.20 / 2)}
STORY_SAMPLE = 30    # count_tokens on this many story requests, scale the rest by characters

SEARCH_SYSTEM = """You review one page of agsist.com, a free farm website, against the real search terms people typed before they landed on it (or that an AI search engine used when it cited the page). Today is {today}.

You get the page's first screen of text as a reader sees it before scrolling, on a desktop (1280x800) and on a phone (390x844), plus the headings and FAQ questions that exist further down the page, then up to 30 search terms with how many times each was shown (impressions; for AI grounding queries, citations).

For each search term decide:
- first_screen: "yes" if the desktop first screen directly answers what the searcher wanted (the number, the map, the date, the calculator they asked for is visible without scrolling), "partly" if it is there but hard to spot or only half of it, "no" if not.
- phone: "yes" | "partly" | "no", the same test on the phone first screen.
- lower: "yes" if a heading or FAQ question further down covers it, else "no".
- missing: one short line saying what the searcher wanted that the first screen does not show. Empty if first_screen is yes.
- off_topic: true if the term is about something this page does not and should not cover (a competitor's own brand, an unrelated product, a different country). Off-topic terms need no fix.

Then give up to 5 suggestions for the page, most impressions helped first. Each is one of:
- "first_screen_line": a line to add or move into the first screen.
- "missing_fact": a fact the page does not show at all.
- "faq": a missing FAQ question, in the searcher's words.
- "title_or_h1": a change to the title or main heading so it matches how people search.
Rules for suggestions:
- Base each one only on what the page already has (its text, headings, FAQ) or plainly needs. If it needs data the page does not show anywhere, set needs_new_data true.
- Never write a number, price, date or statistic in a suggestion. Say what to show ("the next WASDE release date"), never the value.
- Plain farm words, short. No em dashes.

Answer with one JSON object in a ```json fenced block and nothing after it:
{{"page": "<path>", "terms": [{{"q": "<term exactly as given>", "first_screen": "yes|partly|no", "phone": "yes|partly|no", "lower": "yes|no", "missing": "...", "off_topic": false}}], "suggestions": [{{"kind": "first_screen_line|missing_fact|faq|title_or_h1", "text": "...", "helps": ["<term>", "..."], "needs_new_data": false}}], "notes": "..."}}"""

SEARCH_USER = """Page: {url}  (file {page})
Title: {title}
Meta description: {meta}

=== DESKTOP FIRST SCREEN (1280x800, before scrolling) ===
{desktop}

=== PHONE FIRST SCREEN (390x844, before scrolling) ===
{phone}

=== HEADINGS ON THE PAGE ===
{headings}

=== FAQ QUESTIONS ON THE PAGE ===
{faq}

=== SEARCH TERMS (term | Google impressions | Bing impressions | Bing AI citations) ===
{terms}"""

ALT_SYSTEM = """You write alt text for images on agsist.com, a free farm website. You get one image and the text around it on the page, plus the alt text it has now.

Write alt text a screen reader user needs in place of the image:
- Plain words, under 125 characters, say what the image shows.
- No numbers unless you can read them in the image itself.
- Do not start with "Image of" or "Picture of". Do not repeat a caption that sits right next to it word for word.
- If the image is only decoration (a texture, a divider, an icon next to words that say the same thing), set decorative true and alt "".
- Judge the current alt: "good" (accurate and useful), "too_long" (accurate but over 125 characters), "vague", "wrong" (says something the image does not show), or "missing".

Answer with one JSON object in a ```json fenced block and nothing after it:
{"id": "<id>", "alt": "...", "decorative": false, "current": "good|too_long|vague|wrong|missing", "why": "<one line>", "numbers_seen_in_image": ["..."]}"""

ALT_USER = """Image id: {id}
Page: {page}
File: {src}
Current alt: {alt}
Nearby heading: {heading}
Text around it: {context}"""


def search_params(e, today):
    terms = "\n".join(f"{t['q']} | {int(t.get('google', 0))} | {int(t.get('bing', 0))} | {int(t.get('bing_ai_citations', 0))}"
                      for t in e["terms"][:30])
    return {
        "model": MODEL, "max_tokens": MAX_TOKENS["search"],
        "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT["search"]},
        "system": SEARCH_SYSTEM.format(today=today),
        "messages": [{"role": "user", "content": SEARCH_USER.format(
            url=e["url"], page=e["page"], title=e.get("title", ""), meta=e.get("meta", ""),
            desktop=e["desktop"] or "(empty)", phone=e["phone"] or "(empty)",
            headings="\n".join(e.get("headings", [])) or "(none)", faq="\n".join(e.get("faq", [])) or "(none)",
            terms=terms)}],
    }


def alt_params(e):
    return {
        "model": MODEL, "max_tokens": MAX_TOKENS["alt"],
        "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT["alt"]},
        "system": ALT_SYSTEM,
        "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": e["mime"], "data": e["b64"]}},
            {"type": "text", "text": ALT_USER.format(id=e["id"], page=e["page"], src=e["src"], alt=e.get("alt") or "(none)",
                                                     heading=e.get("heading") or "(none)", context=(e.get("context") or "")[:1200])}]}],
    }


def story_params(e):
    import county_stories as CS
    return {
        "model": STORY_MODEL, "max_tokens": MAX_TOKENS["story"],
        "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT["story"]},
        "system": CS.SYSTEM,
        "messages": [{"role": "user", "content": CS.prompt(e["facts"])}],
    }


def set_story_params(e):
    """A story for one page of another set (scripts/stories_core.py: prf, atlas, town, company)."""
    import stories_core as K
    S = K.set_of(e["set"])
    return {
        "model": STORY_MODEL, "max_tokens": SET_STORY_MAX_TOKENS,
        "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT["story"]},
        "system": S.SYSTEM,
        "messages": [{"role": "user", "content": S.prompt(e["facts"])}],
    }


def custom_id(kind, name):
    return ({"search": "s_", "alt": "a_", "story": "c_", "elevsite": "e_"}[kind] + re.sub(r"[^a-zA-Z0-9_-]", "_", name))[:64]


# c: county rain stories; p, f, t, o: the PRF, Atlas, town and company stories (stories_core.cid_of)
def kind_of(cid):
    return {"s": "search", "a": "alt", "c": "story", "p": "story", "f": "story", "t": "story", "o": "story",
            "e": "elevsite"}.get(cid[:1], "alt")


def requests_of(bundle):
    today = bundle.get("today") or time.strftime("%B %-d, %Y")
    out = []
    for e in bundle.get("search", []):
        out.append(("search", custom_id("search", e["page"]), e["page"], search_params(e, today)))
    for e in bundle.get("alt", []):
        out.append(("alt", custom_id("alt", e["id"]), e["id"], alt_params(e)))
    for e in bundle.get("story", []):
        if e.get("set"):
            import stories_core as K
            out.append(("story", K.cid_of(K.set_of(e["set"]), e["id"]), f"{e['set']}:{e['id']}", set_story_params(e)))
            continue
        out.append(("story", custom_id("story", f"{e['st']}_{e['fips']}"), f"{e['st']}:{e['fips']}", story_params(e)))
    for e in bundle.get("elevsite", []):
        import elevsites_job as EJ
        out.append(("elevsite", EJ.cid_of(e["company"]), e["company"],
                    EJ.params(e, model_of("elevsite"), MAX_TOKENS["elevsite"], EFFORT["elevsite"])))
    return out


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


def cost_of(u, model=MODEL):
    pi, po, pw, pr = PRICES[model]
    return (u.get("input_tokens", 0) * pi + u.get("cache_creation_input_tokens", 0) * pw
            + u.get("cache_read_input_tokens", 0) * pr + u.get("output_tokens", 0) * po) / 1e6


def model_of(kind):
    return STORY_MODEL if kind == "story" else MODEL


def worst_case(kind, n_in, max_out=None):
    """Upper bound for one request: the prompt once, full max_tokens of output."""
    pi, po = PRICES[model_of(kind)][:2]
    return (n_in * pi + (max_out or MAX_TOKENS[kind]) * po) / 1e6


def cap_of(bundle):
    return ((COST_CAP if bundle.get("search") or bundle.get("alt") else 0.0) + (STORY_CAP if bundle.get("story") else 0.0)
            + (ELEVSITE_CAP if bundle.get("elevsite") else 0.0))


def estimate(bundle):
    rows, total, per = [], 0.0, {k: 0.0 for k in KINDS}
    # story and elevsite requests: tokens per character, the highest seen in each kind's sample
    ratio, counted = {"story": 0.0, "elevsite": 0.0}, {"story": 0, "elevsite": 0}
    for kind, cid, name, p in requests_of(bundle):
        if kind in ratio and counted[kind] >= STORY_SAMPLE and ratio[kind]:
            n = int(len(json.dumps(p)) * ratio[kind] * 1.1) + 1    # 10% over the worst sampled ratio
        else:
            try:
                n = json.loads(http("POST", "/messages/count_tokens",
                                    {k: p[k] for k in ("model", "system", "messages", "thinking")}))["input_tokens"]
                if kind in ratio:
                    counted[kind] += 1
                    ratio[kind] = max(ratio[kind], n / len(json.dumps(p)))
            except SystemExit as err:
                print(f"::warning::count_tokens failed for {cid} ({err}); using characters / 3", flush=True)
                n = len(json.dumps(p)) // 3
        c = worst_case(kind, n, p.get("max_tokens"))
        rows.append({"custom_id": cid, "job": kind, "input_tokens": n, "worst_case_usd": round(c, 4)})
        total += c; per[kind] += c
        print(f"{cid}: {n} input tokens, worst case ${c:.3f}", flush=True)
    print(f"::notice title=API jobs estimate::worst case ${total:.2f} (search ${per['search']:.2f}, alt ${per['alt']:.2f}, "
          f"story ${per['story']:.2f}, elevsite ${per['elevsite']:.2f}) for {len(rows)} requests (cap ${cap_of(bundle):.0f})", flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump({"run": RUN, "worst_case_usd": round(total, 2), "per_job_usd": {k: round(v, 2) for k, v in per.items()},
               "rows": rows}, open(f"{OUT}/estimate.json", "w"), indent=1)
    return total


def parse_json_block(text):
    for b in reversed(re.findall(r"```json\s*(\{.*?\})\s*```", text, re.S)):
        try:
            return json.loads(b, strict=False)
        except ValueError:
            pass
    i, j = text.find("{"), text.rfind("}")
    if 0 <= i < j:
        try:
            return json.loads(text[i:j + 1], strict=False)
        except ValueError:
            pass
    return None


def cmd_submit(bundle_path):
    if os.path.exists(f"{OUT}/batch.json"):
        sys.exit(f"::error::{OUT}/batch.json already exists (this run was submitted); not submitting a second batch")
    bundle = json.load(open(bundle_path))
    total = estimate(bundle)
    if total > cap_of(bundle):
        sys.exit(f"::error::worst-case estimate ${total:.2f} is over the ${cap_of(bundle):.0f} cap; not submitting")
    reqs = requests_of(bundle)
    assert len({r[1] for r in reqs}) == len(reqs), "custom_id collision"
    b = json.loads(http("POST", "/messages/batches", {"requests": [{"custom_id": c, "params": p} for _, c, _, p in reqs]}, timeout=300))
    rec = {"run": RUN, "batch_id": b["id"], "submitted_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "model": STORY_MODEL if all(r[0] == "story" for r in reqs) else MODEL,
           "models": {k: model_of(k) for k in sorted({r[0] for r in reqs})}, "requests": len(reqs), "items": {c: {"job": k, "name": n} for k, c, n, _ in reqs},
           "worst_case_usd": round(total, 2)}
    json.dump(rec, open(f"{OUT}/batch.json", "w"), indent=1)
    print(f"::notice title=API jobs submitted::batch {b['id']} with {len(reqs)} requests", flush=True)


def collect_from(rec, raw):
    items, per, tok = {}, {k: 0.0 for k in KINDS}, {"input": 0, "output": 0}
    for line in raw.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        cid, res = r["custom_id"], r["result"]
        meta = rec["items"].get(cid, {"job": kind_of(cid), "name": cid})
        entry = {"job": meta["job"], "name": meta["name"], "result": res["type"]}
        if res["type"] == "succeeded":
            m = res["message"]; u = m.get("usage", {})
            cu = cost_of(u, model_of(meta["job"]))
            entry.update(usage=u, cost_usd=round(cu, 5), stop_reason=m.get("stop_reason"))
            per[meta["job"]] += cu
            tok["input"] += u.get("input_tokens", 0); tok["output"] += u.get("output_tokens", 0)
            text = "".join(b.get("text", "") for b in m.get("content", []) if b.get("type") == "text")
            entry["parsed"] = parse_json_block(text)
            if not entry["parsed"]:
                entry["text"] = text[-8000:]
        else:
            entry["error"] = res.get("error")
        items[cid] = entry
    return {"run": rec["run"], "batch_id": rec["batch_id"], "model": rec["model"],
            "collected_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "actual_cost_usd": round(sum(per.values()), 4), "per_job_usd": {k: round(v, 4) for k, v in per.items()},
            "tokens": tok, "results": {k: v["result"] for k, v in items.items()}, "items": items}


def cmd_collect(wait_min):
    rec = json.load(open(f"{OUT}/batch.json"))
    bid = rec["batch_id"]
    deadline = time.time() + wait_min * 60
    while True:
        b = json.loads(http("GET", f"/messages/batches/{bid}"))
        print(f"{bid}: {b['processing_status']} {b.get('request_counts')}", flush=True)
        if b["processing_status"] == "ended" or time.time() > deadline:
            break
        time.sleep(60)
    json.dump(b, open(f"{OUT}/batch-status.json", "w"), indent=1)
    if b["processing_status"] != "ended":
        print("not ended yet; dispatch collect again later", flush=True)
        return
    raw = http("GET", f"/messages/batches/{bid}/results", timeout=600)
    open(f"{OUT}/results-raw.jsonl", "w").write(raw)
    out = collect_from(rec, raw)
    json.dump(out, open(f"{OUT}/results.json", "w"), indent=1)
    print(f"::notice title=API jobs results::actual cost ${out['actual_cost_usd']:.2f} {out['per_job_usd']}", flush=True)


def selftest():
    s = {"page": "usda-calendar.html", "url": "https://agsist.com/usda-calendar", "title": "t", "meta": "m",
         "desktop": "Next WASDE", "phone": "Next", "headings": ["H2: When"], "faq": ["When is WASDE?"],
         "terms": [{"q": "wasde report dates", "google": 488, "bing": 3, "bing_ai_citations": 0}] * 40}
    a = {"id": "rain-print.html#1", "page": "rain-print.html", "src": "/img/x.jpg", "mime": "image/jpeg", "b64": "AAAA",
         "alt": "", "heading": "h", "context": "c"}
    reqs = requests_of({"today": "October 17, 2026", "search": [s], "alt": [a]})
    assert [r[0] for r in reqs] == ["search", "alt"]
    ps, pa = reqs[0][3], reqs[1][3]
    assert ps["model"] == MODEL == pa["model"]
    for p in (ps, pa):
        j = json.dumps(p)
        assert "budget_tokens" not in j and "tool_choice" not in p and "temperature" not in p
        assert p["thinking"] == {"type": "adaptive"}
    assert ps["messages"][0]["content"].count("wasde report dates | 488 | 3 | 0") == 30, "top 30 terms only"
    assert pa["messages"][0]["content"][0]["type"] == "image"
    assert reqs[0][1] == "s_usda-calendar_html" and reqs[1][1] == "a_rain-print_html_1"
    t = 'x\n```json\n{"page": "a", "terms": [{"q": "w", "first_screen": "no"}], "suggestions": []}\n```'
    assert parse_json_block(t)["terms"][0]["first_screen"] == "no"
    assert parse_json_block("no json here") is None
    assert abs(cost_of({"input_tokens": 1_000_000, "output_tokens": 100_000}) - 1.5) < 1e-9
    rec = {"run": "r1", "batch_id": "b", "model": MODEL, "items": {"s_x": {"job": "search", "name": "x.html"}}}
    line = json.dumps({"custom_id": "s_x", "result": {"type": "succeeded", "message": {
        "stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 1000},
        "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": t}]}}})
    out = collect_from(rec, line + "\n" + json.dumps({"custom_id": "a_y", "result": {"type": "errored", "error": {"x": 1}}}))
    assert out["items"]["s_x"]["parsed"]["page"] == "a" and out["results"]["a_y"] == "errored"
    assert abs(out["per_job_usd"]["search"] - 0.006) < 1e-9
    assert worst_case("search", 5000) < 0.1
    st = {"st": "IA", "fips": "19169", "hash": "h", "facts": {"county": "Story County", "state": "Iowa", "year": 2026,
          "through": "Oct 12", "whole_year": False, "total_in": "27.61"}}
    sr = requests_of({"story": [st]})
    assert sr[0][:3] == ("story", "c_IA_19169", "IA:19169") and sr[0][3]["model"] == STORY_MODEL
    assert sr[0][3]["thinking"] == {"type": "adaptive"} and "temperature" not in sr[0][3] and "budget_tokens" not in json.dumps(sr[0][3])
    assert "27.61" in sr[0][3]["messages"][0]["content"] and kind_of("c_IA_19169") == "story"
    assert abs(cost_of({"input_tokens": 1_000_000, "output_tokens": 100_000}, STORY_MODEL) - 3.0) < 1e-9
    assert cap_of({"story": [st]}) == STORY_CAP and cap_of({"search": [s]}) == COST_CAP
    # a full run of every county page stays under its cap: about 1,700 input tokens and the full 1,000 out each
    assert 2700 * worst_case("story", 1700) < STORY_CAP
    rec2 = {"run": "r", "batch_id": "b", "model": STORY_MODEL, "items": {"c_IA_19169": {"job": "story", "name": "IA:19169"}}}
    o2 = collect_from(rec2, json.dumps({"custom_id": "c_IA_19169", "result": {"type": "succeeded", "message": {
        "stop_reason": "end_turn", "usage": {"input_tokens": 1000, "output_tokens": 100},
        "content": [{"type": "text", "text": '```json\n{"story": "x"}\n```'}]}}}))
    assert o2["items"]["c_IA_19169"]["parsed"]["story"] == "x" and abs(o2["per_job_usd"]["story"] - 0.003) < 1e-9
    # the other story sets: one request per page, the set's own rules and facts, the same model and cap
    pf = {"county": "Kent County", "state": "Delaware", "crop_year": 2027, "as_of": "Oct 12", "as_of_iso": "2026-10-12", "grids": 8}
    gr = requests_of({"story": [{"set": "prf", "id": "DE:10001", "hash": "h", "facts": pf},
                                {"set": "town", "id": "ia/hubbard", "hash": "h", "facts": {"town": "Hubbard", "state_code": "IA", "as_of": "Oct 17"}}]})
    assert [(r[0], r[1], r[2]) for r in gr] == [("story", "p_DE_10001", "prf:DE:10001"), ("story", "t_ia_hubbard", "town:ia/hubbard")], gr
    assert gr[0][3]["model"] == STORY_MODEL and "PRF" in gr[0][3]["system"] and "Kent County" in gr[0][3]["messages"][0]["content"]
    assert "as_of_iso" not in gr[0][3]["messages"][0]["content"] and kind_of("p_DE_10001") == kind_of("o_adm") == "story"
    assert cap_of({"story": [{"set": "prf"}]}) == STORY_CAP
    # every set's full batch stays under its cap at the worst case (the facts measured on Oct 18, 2026)
    for n_pages, n_in in ((3070, 2600), (3148, 1300), (1500, 900), (120, 1500)):
        assert n_pages * worst_case("story", n_in, SET_STORY_MAX_TOKENS) < STORY_CAP, (n_pages, n_in)
    assert gr[0][3]["max_tokens"] == SET_STORY_MAX_TOKENS
    # unread elevators' sites: one request per company, Sonnet, its own $35 cap
    import elevsites_job as EJ
    el = {"company": "MEYER BROTHERS GRAIN", "names": ["Meyer Brothers Grain"], "realRows": 3, "upperMidwest": 3,
          "states": {"WI": 3}, "towns": ["Elk Mound, WI"], "pages": [{"url": "https://meyergrain.com/", "text": "Cash Bids"}]}
    er = requests_of({"elevsite": [el]})
    assert er[0][:3] == ("elevsite", "e_MEYER_BROTHERS_GRAIN", "MEYER BROTHERS GRAIN"), er[0][:3]
    assert er[0][3]["model"] == MODEL and er[0][3]["system"] == EJ.SYSTEM and "meyergrain.com" in er[0][3]["messages"][0]["content"]
    assert er[0][3]["thinking"] == {"type": "adaptive"} and "temperature" not in er[0][3] and kind_of("e_X") == "elevsite"
    assert cap_of({"elevsite": [el]}) == ELEVSITE_CAP == 35.0
    # the whole list (about 600 companies at up to 12,000 input tokens each) stays under the cap at the worst case
    assert 600 * worst_case("elevsite", 12000) < ELEVSITE_CAP
    o3 = collect_from({"run": "r", "batch_id": "b", "model": MODEL, "items": {"e_X": {"job": "elevsite", "name": "X"}}},
                      json.dumps({"custom_id": "e_X", "result": {"type": "succeeded", "message": {"stop_reason": "end_turn",
                                  "usage": {"input_tokens": 1000, "output_tokens": 100}, "content": [{"type": "text", "text": '```json\n{"platform": "dtn"}\n```'}]}}}))
    assert o3["items"]["e_X"]["parsed"]["platform"] == "dtn" and abs(o3["per_job_usd"]["elevsite"] - 0.0015) < 1e-9
    print("selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "estimate":
        estimate(json.load(open(a[1])))
    elif a[0] == "submit":
        cmd_submit(a[1])
    elif a[0] == "collect":
        cmd_collect(int(a[1]) if len(a) > 1 else 0)
    else:
        sys.exit("modes: selftest | estimate BUNDLE | submit BUNDLE | collect [WAIT_MINUTES]")
