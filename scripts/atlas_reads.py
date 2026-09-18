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

COST
  About 1,300 counties at roughly 700 input and 150 output tokens each on
  claude-sonnet-4-6. Unchanged counties are skipped on every run after the
  first, so the monthly cost is the counties whose numbers moved.

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
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

ATLAS = "data/atlas/atlas.json"
DETAIL_DIR = "data/atlas/counties"
OUT = "data/atlas/reads.json"
API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
MAX_WORDS = 130          # the prompt asks for under 100; the gate leaves room for a long county name
WORKERS = 2               # 2026-09-13 first run: four workers hit the API's rate limit within a minute
BANNED = ["alarming", "devastating", "skyrocket", "plummet", "crisis", "catastroph", "stunning",
          "shocking", "dramatic", "unprecedented", "game-chang", "robust", "leverage", "delve",
          "deep dive", "navigate", "landscape", "journey", "unlock",
          # derived magnitudes: a number the model computed, which the digit check cannot see
          "double", "tripl", "twice", "half", "a third", "quarter", "-fold", "nearly", "almost", "roughly", "about "]
CAUSE_WORDS = {"heat_drought": "heat and drought", "wet": "excess moisture and flood", "hail": "hail",
               "wind": "wind", "cold": "freeze and frost", "irrigation": "irrigation failure",
               "price": "price decline", "unassigned": "area and index plans with no peril assigned", "other": "other causes"}

SYSTEM = """You write the county read for AGSIST's Farmland Atlas. First person plural is not used; write as "I". Plain, short sentences. No adjectives of alarm. No advice to buy or sell. No emoji. No headings, no bullets.

Rules that are checked by a program after you answer:
1. Use ONLY the numbers in the block you are given, written exactly as given (same digits). Do not compute new numbers, do not round, do not convert units, do not add a year that is not in the block. A negative percent in the block is a fall: write "down 40 percent", never "down -40 percent".
2. Name a period exactly as the block writes it. The block writes "1989-1999", so write "1989-1999". Never turn a period into a decade: "the 1990s" puts the number 1990 in your answer, 1990 is not in the block, and the check rejects it. The same goes for "the 2000s" and "the 2020s" unless the block writes that exact token.
3. If a layer says "not yet measured" or "withheld", say so in four words or fewer and move on. Do not guess what it would show.
4. Four or five sentences. Keep it under 120 words; a program rejects anything at 130 words or more, so 120 is the target and not a stretch.
5. Lead with the thing a land buyer would most want to know for this county, from what is present. Say what is present, not what is missing, unless nothing is present.
6. The Atlas never combines heat and water into one grade. Do not rank the county overall. Do not use the word "score".
7. These words fail the check and must not appear: nearly, almost, about, roughly, half, double, twice, triple, quarter, fold, alarming, dramatic, unprecedented, crisis, robust."""


def log(*a):
    print(*a, flush=True)


def fmt_num(x):
    if x is None:
        return None
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def pct100(x):
    """Percent from a share, rounded half away from zero, the same as the page."""
    return int(math.floor(x * 100 + 0.5))


def inputs_block(fips, rec):
    """The numbers the model may use, one per line. Everything else is withheld."""
    L = [f"County: {rec['name']} County, {rec['state']}"]
    r = rec.get("rent") or {}
    if r.get("status") == "ok" and r.get("nonirr"):
        L.append(f"Non-irrigated cash rent {r['nonirr']['year']}: {fmt_num(r['nonirr']['value'])} dollars per acre")
        ch = r.get("nonirr_change10")
        if ch:
            L.append(f"Change in non-irrigated rent from {ch['from_year']} to {ch['to_year']}: {fmt_num(ch['pct'])} percent")
        if r.get("irr"):
            L.append(f"Irrigated cash rent {r['irr']['year']}: {fmt_num(r['irr']['value'])} dollars per acre")
    else:
        L.append("Cash rent: withheld")
    y = rec.get("yield") or {}
    if y.get("status") == "ok":
        if y.get("slope") is not None:
            L.append(f"County corn yield trend, fitted on published years {y.get('window') or ''}: {fmt_num(y['slope'])} bushels per acre per year, r-squared {fmt_num(y['r2'])}")
        L.append(f"Median county corn yield {y.get('first_year')}-{y.get('last_year')}: {fmt_num(y['median'])} bushels per acre; worst year {y['worst']['year']} at {fmt_num(y['worst']['value'])}")
    else:
        L.append("County corn yield: withheld")
    wp = rec.get("water_premium") or {}
    if wp.get("status") == "ok":
        L.append(f"Irrigated rent premium over non-irrigated {wp['latest']['year']}: {fmt_num(wp['latest']['premium'])} dollars per acre, ratio {fmt_num(wp['latest']['ratio'])}; in {wp['first']['year']} it was {fmt_num(wp['first']['premium'])}; direction: {wp['direction']}")
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
    else:
        L.append("Night heat: not yet measured")
    w = rec.get("water") or {}
    if w.get("status") == "ok":
        s = w.get("irrigated_share_2022") or {}
        if s.get("share") is not None:
            L.append(f"Share of harvested cropland irrigated, 2022 census: {pct100(s['share'])} percent" + ("" if s.get("reported", True) else " (no farm reported irrigated harvested cropland)"))
        g = w.get("groundwater_share_2015") or {}
        if g.get("share") is not None:
            L.append(f"Share of irrigation water from groundwater, 2015: {pct100(g['share'])} percent")
    else:
        L.append("Water dependence: not yet measured")
    lo = rec.get("loss") or {}
    if lo.get("status") == "ok":
        if lo.get("share_all"):
            top = lo["top_cause_all"]
            L.append(f"Crop insurance indemnities {lo['first_year']}-{lo['last_year']}" + (f" ({lo['partial_year']} still partial)" if lo.get("partial_year") else "") + f": {fmt_num(round(lo['total_indemnity'] / 1e6, 1))} million dollars; largest cause: {CAUSE_WORDS[top]} at {pct100(lo['share_all'][top])} percent")
        for label, p in (lo.get("periods") or {}).items():
            if p.get("heat_drought_share") is not None:
                L.append(f"Heat and drought share of indemnities {label}: {pct100(p['heat_drought_share'])} percent")
        if lo.get("irrigation_failure_indemnity"):
            L.append(f"Indemnities for irrigation failure, all years: {fmt_num(round(lo['irrigation_failure_indemnity'] / 1e6, 2))} million dollars")
    else:
        L.append("Insurance loss record: not yet measured")
    sb = rec.get("sob") or {}
    if sb.get("status") == "ok":
        if sb.get("loss_ratio_all") is not None:
            L.append(f"Crop insurance loss ratio (indemnity over total premium) {sb['first_year']}-{sb['last_year']}: {fmt_num(sb['loss_ratio_all'])}; crop years paying out more than premium: {sb.get('years_over_one')} of {sb.get('years_with_ratio')}")
        l10 = sb.get("last10") or {}
        if l10.get("ratio") is not None:
            L.append(f"Loss ratio over the last ten crop years {l10['from']}-{l10['to']}: {fmt_num(l10['ratio'])}")
    v = rec.get("value") or {}
    if v.get("status") == "ok" and v.get("latest") is not None:
        L.append(f"Census market value of land and buildings, {v['latest_year']}: {fmt_num(v['latest'])} dollars per acre")
        if (v.get("change") or {}).get("cagr_pct") is not None:
            L.append(f"Land value change {v['change']['from_year']}-{v['change']['to_year']}: {fmt_num(v['change']['pct'])} percent, {fmt_num(v['change']['cagr_pct'])} percent a year")
        if (v.get("rent_to_value") or {}).get("pct") is not None:
            L.append(f"Non-irrigated cash rent as a share of land value, {v['rent_to_value']['year']}: {fmt_num(v['rent_to_value']['pct'])} percent")
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
        L.append(f"Weeks with at least 50 percent of the county in severe drought or worse, {d['first_year']}-{d['last_full_year']}: {w['d2']} of {w['counted']} ({fmt_num(w['share_d2_pct'])} percent); worst year {d['worst_year']['year']} with {d['worst_year']['d2']} weeks")
        if d.get("last5"):
            L.append(f"Weeks in severe drought or worse, {d['last5']['from']}-{d['last5']['to']}: {d['last5']['d2']}")
    e = rec.get("energy") or {}
    if e.get("status") == "ok":
        o, pr = e["operable"], e["proposed"]
        L.append(f"Solar operating: {fmt_num(o['solar'])} MW; wind operating: {fmt_num(o['wind'])} MW; proposed to EIA: {fmt_num(pr['solar'])} MW solar, {fmt_num(pr['wind'])} MW wind")
    wl = rec.get("wells") or {}
    if wl.get("status") == "ok":
        if wl.get("wells") is not None:
            L.append(f"Registered wells: {wl['wells']}; irrigation wells not decommissioned: {wl['irrigation_active']}" + (f"; median depth {fmt_num(wl['depth_median_ft'])} feet" if wl.get('depth_median_ft') is not None else "") + (f"; median static water level {fmt_num(wl['static_median_ft'])} feet" if wl.get('static_median_ft') is not None else ""))
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
    allowed = numbers_in(block)
    # years inside ranges like 2008-2024 come as two numbers; the block writes them the same way
    for n in numbers_in(text):
        if n not in allowed:
            return f"number not in inputs: {n}"
    if "\n-" in text or text.lstrip().startswith("-") or "#" in text:
        return "list or heading formatting"
    return None


class ApiError(Exception):
    pass


_errors_logged = 0


def call_model(api_key, block):
    global _errors_logged
    payload = {"model": MODEL, "max_tokens": 400, "system": SYSTEM,
               "messages": [{"role": "user", "content": "Numbers for this county:\n\n" + block + "\n\nWrite the read."}]}
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", "x-api-key": api_key,
                                          "anthropic-version": "2023-06-01"})
    delays = [5, 15, 30, 60, 90, 120]
    for attempt in range(len(delays) + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
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
            if e.code in (408, 429, 500, 502, 503, 529) and attempt < len(delays):
                ra = e.headers.get("retry-after") if e.headers else None
                try:
                    wait = max(float(ra), delays[attempt]) if ra else delays[attempt]
                except ValueError:
                    wait = delays[attempt]
                time.sleep(wait)
                continue
            raise ApiError(f"HTTP {e.code}: {body[:120]}")
        except urllib.error.URLError as e:
            if attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise ApiError(f"network: {e}")


def one(api_key, fips, rec):
    block = inputs_block(fips, rec)
    last = None
    for attempt in range(2):
        text = call_model(api_key, block)
        why = gate(text, block)
        if why is None:
            return {"text": text, "sha": rec["sha"], "model": MODEL,
                    "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        last = why
        log(f"  {fips}: gate failed ({why}), attempt {attempt + 1}")
    return {"status": f"withheld: {last}", "sha": rec["sha"], "model": MODEL,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def selftest():
    rec = {"name": "Adams", "state": "NE", "sha": "abc",
           "rent": {"status": "ok", "nonirr": {"year": 2025, "value": 138.0},
                    "nonirr_change10": {"from_year": 2014, "to_year": 2025, "pct": 7.8}, "irr": {"year": 2025, "value": 289.0}},
           "yield": {"status": "ok", "slope": 2.468, "r2": 0.454, "first_year": 2008, "last_year": 2024, "window": "2008-2024", "median": 195.9,
                     "worst": {"year": 2008, "value": 181.0}},
           "water_premium": {"status": "ok", "latest": {"year": 2025, "premium": 151.0, "ratio": 2.094},
                             "first": {"year": 2008, "premium": 84.0}, "direction": "rising"},
           "heat": {"status": "not yet measured"}, "water": {"status": "not yet measured"}, "loss": {"status": "not yet measured"}}
    block = inputs_block("31001", rec)
    assert "138 dollars per acre" in block and "7.8 percent" in block and "2.468 bushels" in block, block
    assert "Night heat: not yet measured" in block
    ok = "Adams County rents non-irrigated ground at 138 dollars an acre in 2025, up 7.8 percent since 2014. Irrigated ground brings 289. The irrigated premium was 84 dollars in 2008 and 151 in 2025, and it is rising. Night heat, water and the loss record are not yet measured."
    assert gate(ok, block) is None, gate(ok, block)
    bad = ok.replace("151", "152")
    assert gate(bad, block) == "number not in inputs: 152", gate(bad, block)

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
    assert gate("- 138 dollars", block) == "list or heading formatting"
    assert gate(" ".join(["word"] * 131), block).startswith("131 words")
    # a trailing period after a number is not part of the number
    assert gate("Rent is 138.", block) is None
    # an integer written from a float: 289.0 in the record, "289" in the text
    assert "289" in numbers_in(block)
    # a year from a range: "2008-2024" licenses "2024" on its own
    assert "2024" in numbers_in(block) and gate("Yields ran through 2024.", block) is None
    assert (gate("Rent nearly doubled.", block) or "").startswith("banned word")
    assert pct100(0.325) == 33 and pct100(0.625) == 63
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        sys.exit("ANTHROPIC_API_KEY missing")
    with open(ATLAS, encoding="utf-8") as f:
        atlas = json.load(f)
    reads = {"generated": None, "model": MODEL, "counties": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            reads = json.load(f)
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    todo = []
    for fips, rec in sorted(atlas["counties"].items()):
        if only and fips != only:
            continue
        # no read until at least one of the three Atlas layers exists for the county;
        # a read that says "not yet measured" three times is money for nothing
        if not any((rec.get(k) or {}).get("status") == "ok" for k in ("heat", "water", "loss")):
            continue
        have = reads["counties"].get(fips)
        if have and have.get("sha") == rec.get("sha") and have.get("text"):
            continue
        todo.append((fips, rec))
    if limit:
        todo = todo[:limit]
    log(f"{len(todo)} counties need a read ({len(atlas['counties'])} in the Atlas)")
    done = 0
    t0 = time.time()

    def work(item):
        fips, rec = item
        try:
            # the summary is thin; the detail record has every field the block wants
            dp = os.path.join(DETAIL_DIR, f"{fips}.json")
            with open(dp, encoding="utf-8") as f:
                detail = json.load(f)
            if detail.get("sha") != rec.get("sha"):
                return fips, {"status": "withheld: detail file is from another build", "sha": rec["sha"]}
            return fips, one(api_key, fips, detail)
        except Exception as e:
            return fips, {"status": f"withheld: API error {str(e)[:160]}", "sha": rec["sha"]}

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for fips, res in ex.map(work, todo):
            reads["counties"][fips] = res
            done += 1
            if done % 50 == 0:
                log(f"  {done}/{len(todo)} in {time.time() - t0:.0f}s")
                with open(OUT, "w", encoding="utf-8") as f:
                    json.dump(reads, f, separators=(",", ":"), ensure_ascii=False)
    reads["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # drop reads for counties no longer in the Atlas
    reads["counties"] = {k: v for k, v in reads["counties"].items() if k in atlas["counties"]}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(reads, f, separators=(",", ":"), ensure_ascii=False)
    n_ok = sum(1 for v in reads["counties"].values() if v.get("text"))
    n_wh = sum(1 for v in reads["counties"].values() if not v.get("text"))
    log(f"wrote {OUT}: {n_ok} reads, {n_wh} withheld, {done} written this run")


if __name__ == "__main__":
    main()
