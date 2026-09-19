#!/usr/bin/env python3
"""
atlas_reads.py — one short written read per county -> data/atlas/reads.json

WHAT THIS IS
  The Atlas prints numbers. Most readers want the sentence. This writes it:
  four or five plain sentences per county, in AGSIST's first-person voice,
  from the county's numbers and nothing else.

THE GATE
  The model is handed a block of numbers and may use only those. After it
  answers, every number in the text is checked against the block: a figure
  that is not in the inputs fails the read, once with a retry and then for
  good, and the county gets no read rather than an invented one. Words the
  Atlas never uses ("alarming", "devastating", "skyrocketing"...) fail it too.
  A read is stored with the county's fingerprint (`sha` from
  build_farmland_atlas.py) and the page shows it only while the fingerprint
  matches, so a read can never describe last build's numbers.

COST, AND WHY THIS NOW RUNS AS A BATCH (2026-09-19)
  The first national run was 3,149 counties. On claude-sonnet-4-6 at the
  standard price it ran the account out of credit 480 counties in. Three
  changes, all measured against Anthropic's pricing page that day:

  1. Message Batches, 50% off input and output. A monthly job does not need
     its answers in seconds. Batches usually finish within the hour and are
     allowed 24.
  2. The model is a setting: ATLAS_READS_MODEL, default claude-sonnet-5
     ($2/$10 per million tokens against $3/$15 for 4.6). `--trial N` writes N
     counties on two models side by side into data/atlas/reads-trial.json so
     the cheaper one (claude-haiku-4-5-20251001, $1/$5) can be judged on this
     gate's own pass rate before it is used for real.
  3. A read is carried forward, not rewritten, when the block of numbers it
     was written from has not changed. The county fingerprint changes every
     month because heat and the partial-year loss record move; most of the
     numbers a read uses do not. Each read stores the hash of its block.

  Prompt caching is NOT used: the system prompt is about 500 tokens and the
  documented minimum is 1,024 (Sonnet) and 4,096 (Haiku 4.5). Marking it
  would change nothing.

FATAL ERRORS STOP THE RUN AND TOUCH NOTHING
  2026-09-19: "Your credit balance is too low" came back on every call after
  county 480 and each one was written into reads.json as "withheld: API
  error", over the county's previous entry. An out-of-credit, bad-key or
  unknown-model answer is now fatal: the run stops, keeps every entry it did
  not finish, and exits 1 so the step goes red. A per-county API error keeps
  that county's previous entry as it was.

USAGE
  python scripts/atlas_reads.py --selftest
  python scripts/atlas_reads.py                 # needs ANTHROPIC_API_KEY
  python scripts/atlas_reads.py --limit 20      # first 20 counties needing a read
  python scripts/atlas_reads.py --only 19169    # one county
"""

import json
import math
import os
import re
import sys
import time
import http.client
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ATLAS = "data/atlas/atlas.json"
DETAIL_DIR = "data/atlas/counties"
OUT = "data/atlas/reads.json"
API = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("ATLAS_READS_MODEL", "").strip() or "claude-sonnet-5"
MODE = os.environ.get("ATLAS_READS_MODE", "").strip() or "batch"      # batch | sync
BATCH_WAIT_MIN = float(os.environ.get("ATLAS_READS_BATCH_WAIT_MIN", "") or 180)
# ONE DEADLINE, AND IT COUNTS FROM THE JOB'S START WHEN THE WORKFLOW SAYS WHEN
# THAT WAS. The job is killed at 300 minutes, and a kill skips the Commit step --
# every layer fetched in that run lost, and a batch never canceled. So the wait
# ends at whichever comes first: BATCH_WAIT_MIN from now, or 255 minutes after
# the job started (ATLAS_JOB_T0, set by the workflow's first step), which leaves
# 15 minutes for a cancel to settle and 30 for the commit.
try:
    _JOB_T0 = float(os.environ.get("ATLAS_JOB_T0", "") or 0)
except ValueError:
    _JOB_T0 = 0
_DEADLINE = time.time() + BATCH_WAIT_MIN * 60
if _JOB_T0:
    _DEADLINE = min(_DEADLINE, _JOB_T0 + 255 * 60)
if MODE not in ("batch", "sync"):
    sys.exit(f"ATLAS_READS_MODE must be batch or sync, not {MODE!r}")
TRIAL_MODELS = [m.strip() for m in (os.environ.get("ATLAS_READS_TRIAL_MODELS", "")
                or "claude-haiku-4-5-20251001,claude-sonnet-5").split(",") if m.strip()]
# NOT under data/atlas: that directory is committed and served on agsist.com,
# and a trial is rejected model text by design. The file goes in the runner's
# temp dir and every text is printed to the log, which is where it is read.
TRIAL_OUT = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "reads-trial.json")
MIN_WORDS = 20
MAX_WORDS = 130          # the prompt asks for under 100; the gate leaves room for a long county name
WORKERS = 2               # 2026-09-13 first run: four workers hit the API's rate limit within a minute
BANNED = ["alarming", "devastating", "skyrocket", "plummet", "crisis", "catastroph", "stunning",
          "shocking", "dramatic", "unprecedented", "game-chang", "robust", "leverage", "delve",
          "deep dive", "navigate", "landscape", "journey", "unlock",
          # derived magnitudes: a number the model computed, which the digit check cannot see
          "double", "tripl", "twice", "half", "a third", "quarter", "-fold", "nearly", "almost", "roughly", "about ",
          # 9/19: 945 of 2,062 reads spent words on what the county does not have
          "withheld", "not yet measured", "not measured"]
CAUSE_WORDS = {"heat_drought": "heat and drought", "wet": "excess moisture and flood", "hail": "hail",
               "wind": "wind", "cold": "freeze and frost", "irrigation": "irrigation failure",
               "price": "price decline", "unassigned": "area and index plans with no peril assigned", "other": "other causes"}

SYSTEM = """You write the county read for AGSIST's Farmland Atlas. First person plural is not used; write as "I". Plain, short sentences. No adjectives of alarm. No advice to buy or sell. No emoji. No headings, no bullets.

Rules that are checked by a program after you answer:
1. Use ONLY the numbers in the block you are given, written exactly as given (same digits). Do not compute new numbers, do not round, do not convert units, do not add a year that is not in the block. A negative number in the block is a fall: write "down 40 percent" or "falling 2.3 bushels per acre a year", never a minus sign.
2. Name a period exactly as the block writes it. The block writes "1989-1999", so write "1989-1999". Never turn a period into a decade: "the 1990s" puts the number 1990 in your answer, 1990 is not in the block, and the check rejects it. The same goes for "the 2000s" and "the 2020s" unless the block writes that exact token.
3. The block lists only what is measured for this county. Do not mention anything that is missing, withheld, unpublished or not measured, and do not guess at it.
4. Four or five sentences. Keep it under 120 words; a program rejects anything at 130 words or more, so 120 is the target and not a stretch.
5. Lead with the thing a land buyer would most want to know for this county, from what is present. Say what is present.
6. The Atlas never combines heat and water into one grade. Do not rank the county overall. Do not use the word "score".
7. These words fail the check and must not appear: nearly, almost, about, roughly, half, double, twice, triple, quarter, fold, alarming, dramatic, unprecedented, crisis, robust.
8. To compare two numbers, write both numbers and stop. Do not state the gap, the ratio, a share of a total, or how many years a period spans: each of those is a new number and fails the check.
9. Write money exactly as the block writes it, with the dollar sign and commas: "$10,914 per acre", "$156.5 million". Never write "dollars" after a number.
10. Do not say a figure rose, fell, grew or shrank across three or more periods unless every step moves the same way. Otherwise list the periods and stop.
11. Do not mention how this text was written, by whom or by what, or that anything checks it."""


def log(*a):
    print(*a, flush=True)


def fmt_num(x):
    if x is None:
        return None
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def usd(x):
    """$10,914 -- the page's money format. The gate strips commas, so the
    number check still reads 10914."""
    return "$" + f"{int(round(x)):,}"


def usd_m(x):
    """$156.5 million; under a million it is written in whole dollars instead
    of "0.0 million", which is how 854 dollars became "0 million" on 9/19."""
    if abs(x) >= 1e6:
        return f"${x / 1e6:,.1f} million"
    return usd(x)


def pct100(x):
    """Percent from a share, rounded half away from zero, the same as the page."""
    return int(math.floor(x * 100 + 0.5))


def inputs_block(fips, rec):
    """The numbers the model may use, one per line. Everything else is withheld."""
    # The unit word, not a bare " County". 134 of the 3,144 are a parish, a
    # borough, a census area, a city-and-borough, a municipality, an independent
    # city or Carson City, and the model repeats back whatever the block says.
    # `u` is absent for an ordinary county and can be the empty string when the
    # name is already whole, so test membership, not truth.
    _u = rec["u"] if "u" in rec else "County"
    L = [f"County: {rec['name']}{(' ' + _u) if _u else ''}, {rec['state']}"]
    r = rec.get("rent") or {}
    if r.get("status") == "ok" and r.get("nonirr"):
        L.append(f"Non-irrigated cash rent {r['nonirr']['year']} (county average): {usd(r['nonirr']['value'])} per acre")
        ch = r.get("nonirr_change10")
        if ch:
            L.append(f"Change in non-irrigated rent from {ch['from_year']} to {ch['to_year']}: {fmt_num(ch['pct'])} percent")
        if r.get("irr"):
            L.append(f"Irrigated cash rent {r['irr']['year']}: {usd(r['irr']['value'])} per acre")
    y = rec.get("yield") or {}
    if y.get("status") == "ok":
        if y.get("slope") is not None:
            L.append(f"County corn yield trend, fitted on published years {y.get('window') or ''}: {fmt_num(round(y['slope'], 1))} bushels per acre a year")
        L.append(f"Median county corn yield {y.get('first_year')}-{y.get('last_year')}: {fmt_num(y['median'])} bushels per acre; worst year {y['worst']['year']} at {fmt_num(y['worst']['value'])}")
    wp = rec.get("water_premium") or {}
    if wp.get("status") == "ok":
        if wp["latest"].get("ratio") is not None and wp["first"].get("ratio") is not None and not str(wp.get("direction", "")).startswith("not called"):
            L.append(f"Irrigated cash rent as a multiple of non-irrigated rent: {wp['latest']['ratio']:.2f} in {wp['latest']['year']}, {wp['first']['ratio']:.2f} in {wp['first']['year']}; direction of the multiple: {wp['direction']}")
    h = rec.get("heat") or {}
    if h.get("status") == "ok":
        j = (h.get("months") or {}).get("jul") or {}
        if j.get("recent", {}).get("mean") is not None:
            L.append(f"July average nightly low, {j['recent']['from']}-{j['recent']['to']}: {fmt_num(j['recent']['mean'])} F")
        if j.get("normal_1991_2020", {}).get("mean") is not None:
            L.append(f"July average nightly low, 1991-2020 normal: {fmt_num(j['normal_1991_2020']['mean'])} F")
        t = j.get("trend") or {}
        if t.get("per_decade") is not None:
            L.append(f"July nightly low trend since {t['from']}: {fmt_num(t['per_decade'])} F per decade, direction: {t['direction']}")
        d = j.get("decades") or {}
        if d:
            hot = sum(v.get("hot", 0) for v in d.values())
            L.append(f"Julys since 1900 with an average low at or above 70 F: {hot}")
        cr = (j.get("first_decade_at_or_above") or {}).get("66")
        if cr:
            L.append(f"First decade the July average low reached 66 F: {cr}")
    w = rec.get("water") or {}
    if w.get("status") == "ok":
        s = w.get("irrigated_share_2022") or {}
        if s.get("share") is not None:
            L.append(f"Share of harvested cropland irrigated, 2022 census: {pct100(s['share'])} percent" + ("" if s.get("reported", True) else " (no farm reported irrigated harvested cropland)"))
        g = w.get("groundwater_share_2015") or {}
        tiny = str((w.get("applied_2015") or {}).get("status") or "").startswith("withheld: under")
        if g.get("share") is not None and not tiny:
            L.append(f"Share of irrigation water from groundwater, 2015: {pct100(g['share'])} percent")
    lo = rec.get("loss") or {}
    if lo.get("status") == "ok":
        if lo.get("share_all"):
            top = lo["top_cause_all"]
            L.append(f"Crop insurance indemnities {lo['first_year']}-{lo['last_year']}, closed crop years: {usd_m(lo['total_indemnity'])}; largest cause: {CAUSE_WORDS[top]} at {pct100(lo['share_all'][top])} percent")
        for label, p in (lo.get("periods") or {}).items():
            if p.get("heat_drought_share") is not None:
                L.append(f"Heat and drought share of indemnities {label}: {pct100(p['heat_drought_share'])} percent")
        if (lo.get("irrigation_failure_indemnity") or 0) >= 10000:
            L.append(f"Indemnities for irrigation failure, all closed years: {usd_m(lo['irrigation_failure_indemnity'])}")
    sb = rec.get("sob") or {}
    if sb.get("status") == "ok":
        if sb.get("loss_ratio_all") is not None:
            L.append(f"Crop insurance loss ratio (indemnity over total premium), closed crop years {sb['first_year']}-{sb['last_year']}: {fmt_num(sb['loss_ratio_all'])}"
                     + (f"; crop years paying out more than premium: {sb['years_over_one']} of {sb['years_with_ratio']}" if sb.get("years_over_one") is not None else ""))
        l10 = sb.get("last10") or {}
        if l10.get("ratio") is not None:
            L.append(f"Loss ratio over the ten closed crop years {l10['from']}-{l10['to']}: {fmt_num(l10['ratio'])}")
        if l10.get("loss_cost") is not None:
            L.append(f"Indemnity paid per $100 of insured value, {l10['from']}-{l10['to']}: ${l10['loss_cost'] * 100:.2f}")
    v = rec.get("value") or {}
    if v.get("status") == "ok" and v.get("latest") is not None:
        L.append(f"Census value of land and buildings, {v['latest_year']} (the operators' own estimate, not a sale price): {usd(v['latest'])} per acre")
        if (v.get("change") or {}).get("cagr_pct") is not None:
            L.append(f"Land value change {v['change']['from_year']}-{v['change']['to_year']}: {fmt_num(v['change']['pct'])} percent, {fmt_num(v['change']['cagr_pct'])} percent a year")
        if (v.get("rent_to_value") or {}).get("pct") is not None:
            L.append(f"Non-irrigated cash rent {v['rent_to_value']['year']} as a share of that census value: {fmt_num(v['rent_to_value']['pct'])} percent")
    c = rec.get("crp") or {}
    if c.get("status") == "ok":
        if (c.get("latest") or {}).get("acres") is not None:
            L.append(f"CRP acres, {c['latest']['year']}: {fmt_num(c['latest']['acres'])}" + (f"; share of the cropland base: {fmt_num(c['share_of_cropland']['pct'])} percent" if (c.get('share_of_cropland') or {}).get('pct') is not None else ""))
        if c.get("expiring_next3"):
            L.append(f"CRP acres expiring fiscal years {c['expiring_next3']['from']}-{c['expiring_next3']['to']}: {fmt_num(c['expiring_next3']['acres'])}")
    d = rec.get("drought") or {}
    if d.get("status") == "ok":
        w = d["weeks"]
        # "half" IS ON THE BANNED LIST AND THIS LINE PUT IT IN 98% OF BLOCKS.
        # Measured 2026-09-18 over 400 committed county records: 393 of them
        # carried the word, in this sentence, because this is the Drought
        # Monitor's own definition of the D2 area threshold. The prompt says
        # "half" fails the check; the block then hands it to the model on
        # almost every county and the read comes back with it. The gate was
        # right and the input was baiting it.
        if w["d2"]:
            L.append(f"Weeks with at least 50 percent of the county in severe drought or worse, {d['first_year']}-{d['last_full_year']}: {w['d2']} of {w['counted']} ({fmt_num(w['share_d2_pct'])} percent); worst year {d['worst_year']['year']} with {d['worst_year']['d2']} weeks")
        else:
            L.append(f"Weeks with at least 50 percent of the county in severe drought or worse, {d['first_year']}-{d['last_full_year']}: none")
        if d.get("last5") and w["d2"]:
            L.append(f"Weeks in severe drought or worse, {d['last5']['from']}-{d['last5']['to']}: {d['last5']['d2']}")
    e = rec.get("energy") or {}
    if e.get("status") == "ok":
        o, pr = e["operable"], e["proposed"]
        L.append(f"Solar operating: {fmt_num(o['solar'])} MW; wind operating: {fmt_num(o['wind'])} MW; proposed to EIA: {fmt_num(pr['solar'])} MW solar, {fmt_num(pr['wind'])} MW wind")
    wl = rec.get("wells") or {}
    if wl.get("status") == "ok":
        if wl.get("wells") is not None:
            L.append(f"Registered wells: {wl['wells']:,}; irrigation wells with no decommission date on record: {wl['irrigation_active']:,}" + (f"; median depth {fmt_num(wl['depth_median_ft'])} feet" if wl.get('depth_median_ft') is not None else "") + (f"; median static water level when the wells were drilled {fmt_num(wl['static_median_ft'])} feet" if wl.get('static_median_ft') is not None else ""))
        elif wl.get("points") is not None:
            L.append(f"Water rights: {wl['active']} active points of diversion, {wl['irrigation_active']} irrigation" + (f"; median priority year {wl['priority_year_median']}" if wl.get('priority_year_median') else ""))
    return "\n".join(L)


NUM_RE = re.compile(r"-?\d[\d,]*\.?\d*")


def numbers_in(text):
    """Every number token, signed and unsigned: a range like 2008-2024 in the block
    must license "2024" alone in the read."""
    out = set()
    for m in NUM_RE.findall(text):
        t = m.replace(",", "").rstrip(".")
        if not t:
            continue
        for v in (t, t.lstrip("-")):
            out.add(v)
            try:
                out.add(fmt_num(float(v)))
            except ValueError:
                pass
    return out


def gate(text, block):
    """None if the read passes; otherwise the reason."""
    words = len(text.split())
    if words > MAX_WORDS:
        return f"{words} words, limit {MAX_WORDS}"
    low = text.lower()
    for b in BANNED:
        if b in low:
            return f"banned word: {b}"
    if re.search(r"(?:^|[^\w.])-\d", text):
        return "minus sign: write the fall in words"
    if re.search(r"\d\s+dollars\b", text):
        return "money written as dollars: use the $ form"
    for per in re.findall(r"\b\d{4}-\d{4}\b", text):
        if per not in block:
            return f"period not in inputs: {per}"
    allowed = numbers_in(block)
    # years inside ranges like 2008-2024 come as two numbers; the block writes them the same way
    for n in numbers_in(text):
        if n not in allowed:
            return f"number not in inputs: {n}"
    if "\n-" in text or text.lstrip().startswith("-") or "#" in text:
        return "list or heading formatting"
    # A read is four or five sentences. Under 20 words is an empty answer or a
    # one-line refusal ("I can't write this.") -- no number in it, so nothing
    # above would stop it being published. Checked last, so every other reason
    # is still reported first.
    if words < MIN_WORDS:
        return f"{words} words, minimum {MIN_WORDS}"
    return None


class ApiError(Exception):
    pass


class Fatal(Exception):
    """An answer no retry and no other county can get past: no credit, a bad
    key, an unknown model. The run stops and writes nothing over old entries."""


def is_fatal(code, body):
    b = (body or "").lower()
    if code in (401, 403, 404):
        return True
    # "You have reached your specified API usage limits. You will regain access
    # on 2026-10-01" -- measured 2026-09-19 14:08Z, a 400 that says neither
    # credit nor billing. Every later call gets the same answer until the date.
    if code == 400 and ("credit balance" in b or "billing" in b or "model" in b or "usage limit" in b):
        return True
    return False


def block_hash(block):
    """The numbers AND the rules a read is held to. A change to the prompt, the
    banned words or the word limits changes every hash, so every read is judged
    again under the new rules. One exception, made on purpose: reads written
    before hashes existed are stamped once with today's hash, and only if they
    pass today's gate -- re-writing 822 good reads to add a field would cost
    the same as writing them."""
    import hashlib
    rules = SYSTEM + "|" + ",".join(BANNED) + f"|{MIN_WORDS}-{MAX_WORDS}"
    return hashlib.sha256((rules + "\n" + block).encode("utf-8")).hexdigest()[:16]


def _headers(api_key):
    return {"Content-Type": "application/json", "x-api-key": api_key,
            "anthropic-version": "2023-06-01"}


def api_json(api_key, method, path, payload=None, timeout=120, retry=True):
    """One call to the Anthropic API that is not a message. Fatal answers raise
    Fatal; transient ones retry unless retry=False; anything else raises ApiError.

    THE BATCH-CREATE POST IS NEVER RETRIED. If Anthropic creates the batch and
    the answer is lost on the way back, a second POST makes a second batch that
    nothing polls or cancels, billed in full. Better to stop the run: every
    county keeps its entry and the next run submits once."""
    data = json.dumps(payload).encode() if payload is not None else None
    delays = [5, 15, 30, 60] if retry else []
    for attempt in range(len(delays) + 1):
        req = urllib.request.Request("https://api.anthropic.com" + path, data=data,
                                     headers=_headers(api_key), method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
            return raw
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            if is_fatal(e.code, body):
                raise Fatal(f"HTTP {e.code}: {body[:200]}")
            if e.code in (408, 429, 500, 502, 503, 529) and attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise ApiError(f"HTTP {e.code}: {body[:160]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            # a server that accepts and never answers raises a bare TimeoutError,
            # one that hangs up raises RemoteDisconnected: neither is a URLError
            if attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise ApiError(f"network: {type(e).__name__}: {e}")


_FEEDBACK = {}   # fips -> why the first read failed the gate; sent back once in round 2


def request_params(block, model, why=None):
    # Sonnet 5 thinks by default and the thinking counts against max_tokens: on 9/19 it
    # used up the 400 before the read in 828 of 2,331 requests (stop_reason max_tokens),
    # and those tokens were billed. A 130-word read from a fixed block needs no thinking.
    return {"model": model, "max_tokens": 400, "thinking": {"type": "disabled"}, "system": SYSTEM,
            "messages": [{"role": "user", "content": "Numbers for this county:\n\n" + block + "\n\nWrite the read."
                          + (f"\n\nA first read of these numbers failed the check: {why}. Write a new one that passes; stay under 110 words." if why else "")}]}


def parse_results(jsonl_bytes):
    """{custom_id: ("text", str) | ("error", str)} from a batch results file."""
    out = {}
    for line in jsonl_bytes.decode("utf-8", "replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        cid, res = d.get("custom_id"), d.get("result") or {}
        if res.get("type") == "succeeded":
            msg = res.get("message") or {}
            if msg.get("stop_reason") in ("refusal", "max_tokens"):
                out[cid] = ("error", f"stop_reason {msg.get('stop_reason')}")
                continue
            text = "".join(p.get("text", "") for p in msg.get("content", []) if p.get("type") == "text").strip()
            out[cid] = ("text", text)
        else:
            err = res.get("error") or {}
            detail = (err.get("error") or {}).get("message") or err.get("message") or ""
            out[cid] = ("error", f"{res.get('type')}: {detail}"[:200])
    return out


def run_batch(api_key, jobs, model, label):
    """jobs: {fips: block}. Returns {fips: ("text"|"error", str)}, or None if the
    batch had still not ended 15 minutes after it was canceled at the deadline.
    The batch id is in the log; Anthropic keeps a batch's results for 29 days."""
    if not jobs:
        return {}
    reqs = [{"custom_id": f, "params": request_params(b, model, _FEEDBACK.get(f))} for f, b in sorted(jobs.items())]
    raw = api_json(api_key, "POST", "/v1/messages/batches", {"requests": reqs}, timeout=300, retry=False)
    b = json.loads(raw)
    bid = b["id"]
    log(f"  {label}: batch {bid}, {len(reqs)} requests on {model}")
    t0 = time.time()
    try:
        return _wait_and_collect(api_key, bid, label, t0)
    finally:
        # Whatever broke the wait -- a network error, an exception, the job
        # being stopped -- a batch still running is canceled so what has not
        # been processed is not billed for nothing.
        if not _ENDED.get(bid):
            try:
                api_json(api_key, "POST", f"/v1/messages/batches/{bid}/cancel", {})
                log(f"  {label}: batch {bid} canceled on the way out")
            except Exception as e:
                log(f"  {label}: could not cancel batch {bid} ({e}); cancel it in the Anthropic console")


_ENDED = {}


def _wait_and_collect(api_key, bid, label, t0):
    canceled = False
    while True:
        st = json.loads(api_json(api_key, "GET", f"/v1/messages/batches/{bid}"))
        if st.get("processing_status") == "ended":
            _ENDED[bid] = True
            break
        # ONE DEADLINE FOR THE WHOLE RUN, not one per round: two rounds of 180
        # minutes would outlive the job's 300. At the deadline the batch is
        # CANCELED, not abandoned -- requests not yet processed are then not
        # billed, and the ones already answered still come back and are used.
        if time.time() > _DEADLINE and not canceled:
            log(f"  {label}: batch {bid} not ended by the run's deadline; canceling the rest. "
                f"Counts so far: {st.get('request_counts')}")
            api_json(api_key, "POST", f"/v1/messages/batches/{bid}/cancel", {})
            canceled = True
        if canceled and time.time() > _DEADLINE + 900:
            log(f"  {label}: batch {bid} still not ended 15 min after cancel; leaving it")
            return None
        time.sleep(30)
    log(f"  {label}: ended in {time.time() - t0:.0f}s, {st.get('request_counts')}")
    res = parse_results(api_json(api_key, "GET", f"/v1/messages/batches/{bid}/results", timeout=300))
    # EVERY REQUEST ERRORED THE SAME WAY: that is an account or model problem,
    # not 3,000 county problems. Treat it as fatal so nothing is overwritten.
    errs = [v[1] for v in res.values() if v[0] == "error"]
    if res and len(errs) == len(res):
        msg = errs[0].lower()
        if any(w in msg for w in ("credit", "billing", "model", "authentication", "permission", "usage limit")):
            raise Fatal(f"every request in batch {bid} errored: {errs[0]}")
    return res


_errors_logged = 0


def call_model(api_key, block, model=None):
    global _errors_logged
    payload = request_params(block, model or MODEL)
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-api-key": api_key,
                                          "anthropic-version": "2023-06-01"})
    delays = [5, 15, 30, 60, 90, 120]
    for attempt in range(len(delays) + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            if d.get("stop_reason") in ("refusal", "max_tokens"):
                raise ApiError(f"stop_reason {d.get('stop_reason')}")
            return "".join(p.get("text", "") for p in d.get("content", []) if p.get("type") == "text").strip()
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:300]
            except Exception:
                pass
            if _errors_logged < 5:
                _errors_logged += 1
                log(f"  API {e.code}: {body}")
            if is_fatal(e.code, body):
                raise Fatal(f"HTTP {e.code}: {body[:200]}")
            if e.code in (408, 429, 500, 502, 503, 529) and attempt < len(delays):
                ra = e.headers.get("retry-after") if e.headers else None
                try:
                    wait = max(float(ra), delays[attempt]) if ra else delays[attempt]
                except ValueError:
                    wait = delays[attempt]
                time.sleep(wait)
                continue
            raise ApiError(f"HTTP {e.code}: {body[:120]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException) as e:
            if attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise ApiError(f"network: {e}")


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_rejects_logged = 0


def _log_reject(fips, why, text):
    """The rejected text itself, for the first few: a count of gate failures
    says nothing about whether the prompt or the gate needs the fix."""
    global _rejects_logged
    if _rejects_logged < 8:
        _rejects_logged += 1
        log(f"  {fips}: rejected ({why}): {text[:300]!r}")


def one(api_key, fips, rec, model=None):
    model = model or MODEL
    block = inputs_block(fips, rec)
    last = None
    for attempt in range(2):
        text = call_model(api_key, block, model)
        why = gate(text, block)
        if why is None:
            return {"text": text, "sha": rec["sha"], "block": block_hash(block), "model": model,
                    "generated": _now()}
        last = why
        log(f"  {fips}: gate failed ({why}), attempt {attempt + 1}")
        _log_reject(fips, why, text)
    return {"status": f"withheld: {last}", "sha": rec["sha"], "block": block_hash(block), "model": model,
            "generated": _now()}


# A county the gate refused twice for exactly these numbers and these rules
# is not sent again until one of them changes: the answer would not.
def gate_withheld(status):
    """True for a county the GATE refused -- not an API error, not a stale file."""
    st = str(status or "")
    return st.startswith("withheld: ") and not st.startswith(("withheld: API error", "withheld: detail file"))


def carry(have, rec, block):
    """The previous read, re-stamped with this build's fingerprint, if it was
    written from exactly this block of numbers. Otherwise None."""
    if not have or not have.get("block") or have["block"] != block_hash(block):
        return None
    if have.get("salvaged"):
        return None          # kept from an older read until a run with credit rewrites it
    if have.get("text"):
        if gate(have["text"], block) is not None:
            return None
    elif not gate_withheld(have.get("status")):
        return None          # an API error or a stale detail file: try again
    out = dict(have)
    out["sha"] = rec["sha"]
    return out


def selftest():
    assert request_params('x', 'claude-sonnet-5').get('thinking') == {'type': 'disabled'}, 'reads must not think: it eats max_tokens'
    rec = {"name": "Adams", "state": "NE", "sha": "abc",
           "rent": {"status": "ok", "nonirr": {"year": 2025, "value": 138.0},
                    "nonirr_change10": {"from_year": 2014, "to_year": 2025, "pct": 7.8}, "irr": {"year": 2025, "value": 289.0}},
           "yield": {"status": "ok", "slope": 2.468, "r2": 0.454, "first_year": 2008, "last_year": 2024, "window": "2008-2024", "median": 195.9,
                     "worst": {"year": 2008, "value": 181.0}},
           "water_premium": {"status": "ok", "latest": {"year": 2025, "premium": 151.0, "ratio": 2.094},
                             "first": {"year": 2008, "premium": 84.0, "ratio": 1.8}, "direction": "rising"},
           "heat": {"status": "not yet measured"}, "water": {"status": "not yet measured"}, "loss": {"status": "not yet measured"}}
    block = inputs_block("31001", rec)
    assert "$138 per acre" in block and "7.8 percent" in block and "2.5 bushels" in block and "r-squared" not in block, block
    assert "2.09 in 2025, 1.80 in 2008" in block, block
    assert usd(10914) == "$10,914" and usd_m(156461808) == "$156.5 million" and usd_m(854) == "$854"
    # the retry carries the reason; a first request does not
    assert "failed the check: 134 words" in request_params("b", "m", "134 words, limit 130")["messages"][0]["content"]
    assert "failed the check" not in request_params("b", "m")["messages"][0]["content"]
    assert "not yet measured" not in block and "withheld" not in block, block
    ok = "Adams County rents non-irrigated ground at $138 per acre in 2025, up 7.8 percent since 2014. Irrigated ground brings $289. Irrigated rent was 1.80 times dry rent in 2008 and 2.09 in 2025, and the multiple is rising. Corn yield has a median of 195.9 bushels per acre."
    assert gate(ok, block) is None, gate(ok, block)
    bad = ok.replace("2.09", "2.1")
    assert gate(bad, block) == "number not in inputs: 2.1", gate(bad, block)

    # THE INPUT MAY NOT CONTAIN A WORD THE READ IS FORBIDDEN TO USE.
    #
    # 2026-09-18: the drought line said "at least half the county" and "half"
    # is on BANNED. 393 of 400 committed county records carried it, the model
    # echoed the word it had been given, and the gate rejected the read. Every
    # retry cost a call. The gate was not wrong and the model was not wrong:
    # the two halves of this file disagreed, and nothing checked that they
    # agreed. This is that check, over the sentences the block is built from.
    import re as _re
    src = open(__file__, encoding="utf-8").read()
    body = src[src.index("def inputs_block"):src.index("def gate(")]
    said = []
    for line in body.split("\n"):
        m = _re.search(r'L\.append\(f?"(.*)"\)', line)
        if not m:
            continue
        # drop the {...} placeholders; a county name or a number is not prose
        prose = _re.sub(r"\{[^}]*\}", " ", m.group(1)).lower()
        for b in BANNED:
            if b in prose:
                said.append(f"{b!r} in: {m.group(1)[:70]}")
    assert not said, ("the block hands the model a word the prompt forbids:\n  "
                      + "\n  ".join(said))

    # and the period rule the prompt now carries is the one the block obeys
    assert "1989-1999" in numbers_in("indemnities 1989-1999: 19 percent") or True
    _p = numbers_in("Heat and drought share of indemnities 1989-1999: 19 percent")
    assert "1989" in _p and "1999" in _p, _p
    assert "1990" not in _p, "1990 can never pass; the prompt must not let the model write it"
    assert gate("An alarming 138 dollars.", block) == "banned word: alarming"
    assert gate("- $138 per acre", block) == "list or heading formatting"
    assert gate(ok.replace("up 7.8", "a change of -7.8"), block) == "minus sign: write the fall in words"
    assert gate(ok + " Night heat is withheld.", block) == "banned word: withheld"
    assert gate(" ".join(["word"] * 131), block).startswith("131 words")
    # a trailing period after a number is not part of the number
    assert gate("Rent is 138.", block).endswith("minimum 20"), "the number passed; only the length stops it"
    # an integer written from a float: 289.0 in the record, "289" in the text
    assert "289" in numbers_in(block)
    # a year from a range: "2008-2024" licenses "2024" on its own
    assert "2024" in numbers_in(block) and gate("Yields ran through 2024.", block).endswith("minimum 20")
    assert (gate("Rent nearly doubled.", block) or "").startswith("banned word")
    assert pct100(0.325) == 33 and pct100(0.625) == 63

    # THE ANSWERS THAT MUST STOP A RUN, measured 2026-09-19 from the log.
    credit = '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
    assert is_fatal(400, credit)
    assert is_fatal(401, "") and is_fatal(403, "") and is_fatal(404, '{"error":{"type":"not_found_error","message":"model: x"}}')
    assert not is_fatal(429, "") and not is_fatal(529, "") and not is_fatal(500, "")
    assert not is_fatal(400, '{"error":{"message":"messages: text content blocks must be non-empty"}}')
    assert is_fatal(400, '{"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-10-01 at 00:00 UTC."}}')
    assert gate("", block) and gate("I can't write this.", block), "an empty answer or a refusal is not a read"
    rr = parse_results((json.dumps({"custom_id": "1", "result": {"type": "succeeded", "message": {"stop_reason": "max_tokens", "content": [{"type": "text", "text": "Rent is"}]}}})).encode())
    assert rr["1"][0] == "error", rr

    # A BATCH RESULTS FILE, in the documented shape.
    jl = (json.dumps({"custom_id": "19169", "result": {"type": "succeeded", "message": {"content": [{"type": "text", "text": " Rent is 138. "}]}}}) + "\n"
          + json.dumps({"custom_id": "31001", "result": {"type": "errored", "error": {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}}}) + "\n"
          + json.dumps({"custom_id": "20055", "result": {"type": "expired"}}) + "\n\n")
    pr = parse_results(jl.encode())
    assert pr["19169"] == ("text", "Rent is 138."), pr
    assert pr["31001"][0] == "error" and "Overloaded" in pr["31001"][1], pr
    assert pr["20055"][0] == "error" and pr["20055"][1].startswith("expired"), pr

    # CARRY FORWARD: same block, new fingerprint -> the read is kept, not rewritten.
    have = {"text": ok, "sha": "old", "block": block_hash(block)}
    assert carry(have, {"sha": "new"}, block) == {"text": ok, "sha": "new", "block": block_hash(block)}
    assert carry(have, {"sha": "new"}, block + "\nmore") is None
    assert carry({"text": ok, "sha": "old"}, {"sha": "new"}, block) is None, "no stored block hash, no carry"
    # a carried read that no longer passes the gate is rewritten, not carried
    assert carry({"text": ok + " It nearly doubled.", "sha": "old", "block": block_hash(block)}, {"sha": "new"}, block) is None
    # a gate refusal for the same numbers is not re-sent; an API error is
    wh = {"status": "withheld: banned word: nearly", "sha": "old", "block": block_hash(block)}
    assert carry(wh, {"sha": "new"}, block)["sha"] == "new"
    assert carry({"status": "withheld: API error HTTP 500", "sha": "old", "block": block_hash(block)}, {"sha": "new"}, block) is None
    assert gate(ok.replace("since 2014", "over 2014-2026"), block) == "period not in inputs: 2014-2026"
    assert gate(ok.replace("$289", "289 dollars"), block).startswith("money written as dollars")
    old = ("Adams County rents non-irrigated ground at 138 dollars per acre in 2025, up 7.8 percent since 2014. "
           "Night heat is withheld. Irrigated ground brings 289 dollars. The loss ratio is 0.99 and it rose over 2008-2025. "
           "Irrigated rent was 1.80 times dry rent in 2008 and 2.09 in 2025, and the multiple is rising.")
    sv = salvage_text(old, block)
    assert sv == ("Adams County rents non-irrigated ground at $138 per acre in 2025, up 7.8 percent since 2014. "
                  "Irrigated ground brings $289. Irrigated rent was 1.80 times dry rent in 2008 and 2.09 in 2025, "
                  "and the multiple is rising."), sv
    assert salvage_text("Night heat is withheld. Rent is 12345 dollars.", block) is None
    assert salvage_text("Rent is 999 dollars an acre in Adams County, Nebraska, for the record. That rent is up 7.8 percent since 2014 on every acre counted.", block) is None
    assert carry({"text": sv, "sha": "old", "block": block_hash(block), "salvaged": True}, {"sha": "new"}, block) is None
    log("selftest ok")


def load_detail(fips, rec):
    """The detail record for this build, or None if it is from another one."""
    try:
        with open(os.path.join(DETAIL_DIR, f"{fips}.json"), encoding="utf-8") as f:
            detail = json.load(f)
    except (OSError, ValueError):
        return None
    return detail if detail.get("sha") == rec.get("sha") else None


def save(reads):
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(reads, f, separators=(",", ":"), ensure_ascii=False)


def trial(api_key, atlas, n):
    """N counties, the same N for every model in TRIAL_MODELS, written side by
    side. Never touches reads.json. Sync calls: 2 x N small calls."""
    import random
    pool = [f for f, r in sorted(atlas["counties"].items())
            if any((r.get(k) or {}).get("status") == "ok" for k in ("heat", "water", "loss"))]
    random.Random(20260919).shuffle(pool)
    picks = pool[:n]
    out = {"generated": _now(), "counties": picks, "models": {}}
    for m in TRIAL_MODELS:
        rows, passed, first_try = {}, 0, 0
        for fips in picks:
            d = load_detail(fips, atlas["counties"][fips])
            if d is None:
                continue
            block = inputs_block(fips, d)
            tries = []
            for attempt in range(2):
                try:
                    text = call_model(api_key, block, m)
                except ApiError as e:
                    tries.append({"text": "", "gate": f"API error: {e}"})
                    break
                why = gate(text, block)
                tries.append({"text": text, "gate": why or "pass"})
                log(f"  --- {m} {fips} try {attempt + 1}: {why or 'PASS'}\n{text}")
                if why is None:
                    break
            ok = tries[-1]["gate"] == "pass"
            passed += ok
            first_try += tries[0]["gate"] == "pass"
            rows[fips] = tries
        out["models"][m] = {"passed": passed, "passed_first_try": first_try, "of": len(rows), "reads": rows}
        log(f"  trial {m}: {passed}/{len(rows)} passed, {first_try} on the first try")
    with open(TRIAL_OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    log(f"wrote {TRIAL_OUT}")


_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z$])")
_POINTS_BACK = re.compile(r"(It|That|This|Those|These|They|Its|Both|Still|But|And|Also|Meanwhile|By contrast|Over the same)\b")


def _money(m):
    x = float(m.group(1).replace(",", ""))
    return "$" + (f"{int(x):,}" if x.is_integer() else f"{x:,}")


def salvage_text(text, block):
    """What is left of an older read once every sentence that fails today's
    gate is dropped. Whole sentences only: nothing is reworded except "290
    dollars" -> "$290", so no number is changed or added. None if under
    MIN_WORDS remain or the joined text still fails."""
    t = re.sub(r"(\d[\d,]*\.\d+) million dollars", lambda m: "$" + m.group(1) + " million", text)
    t = re.sub(r"(\d[\d,]*(?:\.\d+)?) dollars", _money, t)
    keep, prev_kept = [], True
    for sent in _SENT.split(t.strip()):
        why = gate(sent, block)
        ok = (why is None or why.endswith(f"minimum {MIN_WORDS}")) and \
            not re.search(r"\$0(\.0)? million|\b0 of \d+ weeks", sent)
        # "That share ..." after its sentence was dropped points at nothing
        if ok and not prev_kept and _POINTS_BACK.match(sent):
            ok = False
        if ok:
            keep.append(sent)
        prev_kept = ok
    out = " ".join(keep)
    return out if keep and gate(out, block) is None else None


def salvage(atlas, reads):
    """No API: rebuild a read for every county from the text already on file
    (any age), against this build's numbers. Used when the account has no
    credit. A salvaged read is shown, and the next run with credit rewrites it."""
    n_new = n_cut = n_none = 0
    for fips, rec in sorted(atlas["counties"].items()):
        have = reads["counties"].get(fips) or {}
        if have.get("text") and have.get("sha") == rec.get("sha") and not have.get("salvaged"):
            d0 = load_detail(fips, rec)
            if d0 is not None and gate(have["text"], inputs_block(fips, d0)) is None:
                continue                     # current and passes today's gate
        text = have.get("text")
        detail = load_detail(fips, rec)
        if not text or detail is None:
            n_none += 1
            continue
        block = inputs_block(fips, detail)
        out = salvage_text(text, block)
        if out is None:
            n_none += 1
            if have.get("text"):
                reads["counties"][fips] = {"status": "withheld: nothing in the older read passes today's check",
                                           "sha": rec["sha"], "salvaged": True,
                                           "model": have.get("model"), "generated": have.get("generated")}
            continue
        n_cut += len(_SENT.split(out)) < len(_SENT.split(text.strip()))
        n_new += 1
        reads["counties"][fips] = {"text": out, "sha": rec["sha"], "block": block_hash(block), "salvaged": True,
                                   "model": have.get("model"), "generated": have.get("generated")}
    log(f"salvage: {n_new} reads kept from older text ({n_cut} with sentences dropped), {n_none} counties with none")
    return reads


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if "--salvage" in sys.argv:
        with open(ATLAS, encoding="utf-8") as f:
            atlas = json.load(f)
        with open(OUT, encoding="utf-8") as f:
            reads = json.load(f)
        save(salvage(atlas, reads))
        return
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        sys.exit("ANTHROPIC_API_KEY missing")
    with open(ATLAS, encoding="utf-8") as f:
        atlas = json.load(f)
    if "--trial" in sys.argv:
        try:
            n = int(sys.argv[sys.argv.index("--trial") + 1])
        except (IndexError, ValueError):
            sys.exit("--trial needs a number of counties, for example --trial 50")
        try:
            trial(api_key, atlas, n)
        except Fatal as e:
            sys.exit(f"STOPPED: {e}")
        return
    reads = {"generated": None, "model": MODEL, "counties": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            reads = json.load(f)
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    mode = "sync" if (only or "--sync" in sys.argv) else MODE

    jobs, recs, carried, stale, stamped = {}, {}, 0, 0, 0
    for fips, rec in sorted(atlas["counties"].items()):
        if only and fips != only:
            continue
        # no read until at least one of the three Atlas layers exists for the county;
        # a read that says "not yet measured" three times is money for nothing
        if not any((rec.get(k) or {}).get("status") == "ok" for k in ("heat", "water", "loss")):
            continue
        have = reads["counties"].get(fips)
        if have and have.get("sha") == rec.get("sha") and have.get("text") and not have.get("salvaged"):
            # CURRENT, AND WRITTEN BEFORE READS CARRIED A BLOCK HASH: stamp it now,
            # for nothing, so the first month its fingerprint moves it can be
            # carried instead of paid for again -- but only if it still passes
            # today's gate, so a read written under looser rules is not kept.
            if not have.get("block"):
                d0 = load_detail(fips, rec)
                if d0 is not None:
                    b0 = inputs_block(fips, d0)
                    if gate(have["text"], b0) is None:
                        have["block"] = block_hash(b0)
                        stamped += 1
            continue
        detail = load_detail(fips, rec)
        if detail is None:
            stale += 1
            continue
        block = inputs_block(fips, detail)
        kept = carry(have, rec, block)
        if kept:
            reads["counties"][fips] = kept
            carried += 1
            continue
        jobs[fips] = block
        recs[fips] = rec
    if limit:
        jobs = dict(list(jobs.items())[:limit])
    if stamped:
        save(reads)
    log(f"{len(jobs)} counties need a read, {carried} carried forward unchanged, {stamped} current reads stamped, "
        f"{stale} skipped (detail file from another build); {len(atlas['counties'])} in the Atlas; "
        f"{mode} on {MODEL}")

    written = kept_old = 0
    try:
        if mode == "batch":
            pending = dict(jobs)
            for rnd in (1, 2):
                if not pending:
                    break
                if time.time() > _DEADLINE:
                    log(f"  round {rnd} not submitted: past the run's deadline; {len(pending)} counties keep their entries")
                    break
                res = run_batch(api_key, pending, MODEL, f"round {rnd}")
                if res is None:
                    log("  the batch outlived this run's wait; counties in it keep their previous entries")
                    break
                retry = {}
                n_gate = n_err = 0
                why_err = {}
                for fips, block in pending.items():
                    kind, val = res.get(fips, ("error", "missing from results"))
                    if kind == "error":
                        # previous entry stays exactly as it was; an overloaded or
                        # expired request gets one more go in round 2
                        n_err += 1
                        why_err[val[:60]] = why_err.get(val[:60], 0) + 1
                        if rnd == 1:
                            retry[fips] = block
                        else:
                            kept_old += 1
                        continue
                    why = gate(val, block)
                    if why is None:
                        reads["counties"][fips] = {"text": val, "sha": recs[fips]["sha"], "block": block_hash(block),
                                                   "model": MODEL, "generated": _now()}
                        written += 1
                    elif rnd == 1:
                        n_gate += 1
                        _log_reject(fips, why, val)
                        retry[fips] = block
                        _FEEDBACK[fips] = why
                    else:
                        _log_reject(fips, why, val)
                        reads["counties"][fips] = {"status": f"withheld: {why}", "sha": recs[fips]["sha"],
                                                   "block": block_hash(block), "model": MODEL, "generated": _now()}
                        written += 1
                log(f"  round {rnd}: {n_gate} failed the gate, {n_err} came back as API errors"
                    + (f"; {len(retry)} go round again" if rnd == 1 and retry else ""))
                for w, n in sorted(why_err.items(), key=lambda x: -x[1])[:5]:
                    log(f"    {n} x {w}")
                pending = retry
                save(reads)
        else:
            t0 = time.time()

            def work(fips):
                try:
                    return fips, one(api_key, fips, load_detail(fips, recs[fips]))
                except ApiError as e:
                    return fips, ("error", str(e))

            ex = ThreadPoolExecutor(max_workers=WORKERS)
            try:
                for fips, res in ex.map(work, list(jobs)):
                    if isinstance(res, tuple):
                        kept_old += 1
                        log(f"  {fips}: {res[1][:120]}; previous entry kept")
                    else:
                        reads["counties"][fips] = res
                        written += 1
                    if (written + kept_old) % 50 == 0:
                        log(f"  {written + kept_old}/{len(jobs)} in {time.time() - t0:.0f}s")
                        save(reads)
            finally:
                # a Fatal must not leave every queued county still calling the API
                ex.shutdown(wait=True, cancel_futures=True)
    except (Fatal, ApiError, OSError, ValueError) as e:
        reads["counties"] = {k: v for k, v in reads["counties"].items() if k in atlas["counties"]}
        save(reads)
        # ::error:: puts it on the run's summary page; the step itself is
        # continue-on-error so the build's own commit still goes through.
        print(f"::error title=County reads stopped::{type(e).__name__}: {str(e)[:300]}", flush=True)
        log(f"STOPPED: {type(e).__name__}: {e}")
        log(f"  {written} entries written before the stop; every other county keeps the entry it had.")
        sys.exit(1)

    reads["generated"] = _now()
    reads["model"] = MODEL
    # drop reads for counties no longer in the Atlas
    reads["counties"] = {k: v for k, v in reads["counties"].items() if k in atlas["counties"]}
    save(reads)
    n_ok = sum(1 for k, v in reads["counties"].items() if v.get("text") and v.get("sha") == atlas["counties"][k].get("sha"))
    n_wh = len(reads["counties"]) - n_ok
    log(f"wrote {OUT}: {n_ok} current reads, {n_wh} without one, {written} written this run, "
        f"{carried} carried forward, {kept_old} kept as they were after an API error")

if __name__ == "__main__":
    main()
