#!/usr/bin/env python3
"""Grain discount, shrink, drying and storage schedules from elevators' own sites.

For the "which elevator really pays more" tool (not published). The bids repo
captures each company's home page and the links that look like schedules
(capture.yml list=probe-lists/schedules.txt pick=schedule follow=6 depth=2
save=schedules; PDFs are read to text there). This file:

  bundle CAPS_CLONE OUT     newest caps/ folder on the bids `schedules` branch
                            (or $SCHEDULES_CAPS): one request per company that
                            has at least one page naming shrink, drying,
                            discounts or storage. Companies with none are
                            listed in the bundle as "nothing to read" and never
                            sent.
  collect BUNDLE RESULTS DIR
                            every number the model returns must be written in
                            its own quote, and every quote must be in the
                            page it names; what fails is dropped and said so.
                            Writes DIR/schedules.json and DIR/schedules.md.

The model call goes through scripts/api_jobs.py (job kind "schedule"). Opus:
this is reading numbers out of tables and fine print, not naming a vendor, and
a wrong shrink figure is worse than none. Nothing here touches a page: the
output is a finding for a person.
"""
import json
import os
import re
import sys

import elevsites_job as EJ

TEXT_BUDGET = 36000
MIN_PAGE_TEXT = 3000
SCHED_WORDS = re.compile(r"shrink|drying|dry charge|moisture discount|discount schedule|test weight|storage (rate|charge|fee)|"
                         r"per point|damage|foreign material|\bdiscounts?\b", re.I)
FIELDS_ONE = ("base_moisture", "shrink_per_point", "shrink_handling", "drying_per_point", "drying_above", "drying_flat")
FIELDS_LIST = ("test_weight", "damage", "foreign_material", "storage")

SYSTEM = """You read saved copies of one grain elevator company's own website for agsist.com, a free farm website building a fair comparison of what elevators really pay after discounts. You get the company's names, then each saved page (web page text or a PDF's text) with its URL.

Find every grain discount, shrink, drying charge or storage schedule the saved pages show, and copy it out. One schedule per crop and page (if one table covers corn and soybeans with different numbers, give two).

For each schedule:
- crop: corn, soybeans, wheat, sorghum, oats, or other (say which in notes).
- source_url: the URL of the page the schedule is on, copied exactly from a "=== PAGE" line.
- effective: the effective date or crop year as written ("2026 harvest", "Effective 9/1/2026"), or "" if none is shown.
- quote: copy the part of the page that holds the schedule, exactly as it appears in the text given (same words, same numbers; whitespace may differ), up to 1500 characters. Every number you give below must be inside this quote.
- For each number: an object {"as_written": "<the shortest piece of the quote that holds the number and its unit, copied exactly>", "value": <the number as a plain decimal>, "unit": "<one of the units below>"}. Use null when the schedule does not give it. Never work a number out, convert between units, or fill one in from what is usual.
  base_moisture (unit "pct"), shrink_per_point (unit "pct_per_point"; e.g. 1.4% per point), shrink_handling (unit "pct"; a flat handling or invisible shrink added once), drying_per_point (unit "cents_per_point" or "dollars_per_point", as written), drying_above (unit "pct", the moisture where drying charges start), drying_flat (unit "cents_per_bu" or "dollars_per_bu", a flat charge before the per-point charge, if any).
  Lists, each item {"threshold": <number object>, "discount": <number object>, "note": "<short, as written>"}:
  test_weight (threshold unit "lbs_per_bu"), damage (threshold unit "pct"), foreign_material (threshold unit "pct"), storage (no threshold: put the period in note, e.g. "per month after Dec 31"; discount unit "cents_per_bu" or "dollars_per_bu").
  Discount units: "cents_per_bu", "dollars_per_bu", "pct_of_price", "pct_shrink".
- notes: one short line for anything that does not fit ("discounts are per half point", "schedule for members only").

If no saved page shows a schedule, give an empty list and say in no_schedule_reason what the pages showed ("links to a discount PDF that was not saved", "bids only, no discounts", "pages failed to load").

Rules: never invent a number, a date or a URL. Copy, do not compute. If a table is too garbled to read row by row, quote it and leave the numbers null with a note.

Answer with one JSON object in a ```json fenced block and nothing after it:
{"company": "<as given>", "schedules": [{"crop": "", "source_url": "", "effective": "", "quote": "", "base_moisture": null, "shrink_per_point": null, "shrink_handling": null, "drying_per_point": null, "drying_above": null, "drying_flat": null, "test_weight": [], "damage": [], "foreign_material": [], "storage": [], "notes": ""}], "no_schedule_reason": "", "notes": ""}"""

UNITS = {"pct", "pct_per_point", "cents_per_point", "dollars_per_point", "cents_per_bu", "dollars_per_bu", "lbs_per_bu",
         "pct_of_price", "pct_shrink"}


def cid_of(company):
    return ("d_" + re.sub(r"[^a-zA-Z0-9_-]", "_", company))[:64]


def label(company):
    return re.sub(r"^[RU]:", "", company)


def prompt(e):
    parts = [f"Company: {label(e['company'])}", f"Names: {'; '.join(e.get('names', [])) or '(none)'}",
             f"We read its bids now: {'yes' if e.get('read') else 'no'}", ""]
    for i, p in enumerate(e["pages"], 1):
        parts.append(f"=== PAGE {i}: {p['url']}" + (f"  (linked from {p['parent']})" if p.get("parent") else "") + ("  (PDF)" if p.get("pdf") else ""))
        if p.get("skipped"):
            parts.append(f"Not saved: {p['skipped']}"); continue
        if p.get("error") or p.get("navError"):
            parts.append(f"Load problem: {p.get('error') or p.get('navError')}")
        parts.append(f"Title: {p.get('title') or '(none)'}")
        if p.get("pdfLinks"):
            parts.append("PDF links (not saved unless listed as a page): " + " ".join(f"{l['url']} ({l['text']})" for l in p["pdfLinks"]))
        parts.append("Text:\n" + (p.get("text") or "(empty)"))
        parts.append("")
    return "\n".join(parts)


def params(e, model, max_tokens, effort):
    return {"model": model, "max_tokens": max_tokens, "thinking": {"type": "adaptive"}, "output_config": {"effort": effort},
            "system": SYSTEM, "messages": [{"role": "user", "content": prompt(e)}]}


def trim_text(text, budget):
    """Keep the part of a long page around the schedule words, not just its head."""
    t = text or ""
    if len(t) <= budget:
        return t
    m = SCHED_WORDS.search(t)
    start = max(0, (m.start() if m else 0) - budget // 6)
    return t[start:start + budget]


def build_bundle(caps):
    wl = json.load(open(os.path.join(caps, "worklist.json")))
    comp = {c["company"]: c for c in wl["companies"]}
    by = EJ.group_by_seed(caps, EJ.load_pages(caps))
    rows, skipped = [], []
    for c in sorted(set(by) | set(comp)):
        ps = by.get(c, [])
        meta = comp.get(c, {"company": c})
        hit = [p for p in ps if SCHED_WORDS.search(p.get("text") or "")]
        if not hit:
            skipped.append({"company": c, "read": bool(meta.get("read")), "pages": len(ps),
                            "why": "no saved page names shrink, drying, discounts or storage" if ps else "nothing captured"})
            continue
        # the home page and the pages that name a schedule; the rest only by title
        keep = [p for p in ps if p in hit or p.get("parent") is None]
        per = max(MIN_PAGE_TEXT, TEXT_BUDGET // max(1, len(keep)))
        pages = []
        for p in keep:
            q = {k: p.get(k) for k in ("url", "parent", "skipped", "error", "navError", "title", "pdf", "pdfLinks")}
            q["text"] = trim_text(p.get("text"), per if p in hit else 2000)
            q["pdfLinks"] = [l for l in (p.get("pdfLinks") or []) if SCHED_WORDS.search(f"{l.get('url')} {l.get('text')}")][:10]
            pages.append(q)
        rows.append({"company": c, "names": meta.get("names", [])[:8], "read": bool(meta.get("read")),
                     "locations": meta.get("locations", 0), "upperMidwest": meta.get("upperMidwest", 0),
                     "states": meta.get("states", {}), "pages": pages})
    rows.sort(key=lambda r: (not r["read"], -(r["upperMidwest"] > 0), -r["locations"], r["company"]))
    return {"job": "schedules", "caps": os.path.basename(caps), "schedule": rows, "nothingToRead": skipped}


# ── collect ───────────────────────────────────────────────────────────────
norm = EJ.norm


def nums_in(s):
    return [float(x) for x in re.findall(r"(?<![\d.])\d*\.?\d+", str(s).replace(",", ""))]


def check_num(o, quote, path, flags, units=UNITS):
    """A number object kept only when its as_written piece is in the quote and holds that number."""
    if o is None:
        return None
    if not isinstance(o, dict):
        flags.append(f"{path}: not an object; dropped"); return None
    aw, v, u = str(o.get("as_written") or ""), o.get("value"), o.get("unit")
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        flags.append(f"{path}: no number; dropped"); return None
    if u not in units:
        flags.append(f"{path}: unit {u!r} not allowed; dropped"); return None
    if not aw or norm(aw) not in quote:
        flags.append(f"{path}: {aw!r} not in the quote; dropped"); return None
    if not any(abs(n - v) < 1e-9 for n in nums_in(aw)):
        flags.append(f"{path}: {v} is not written in {aw!r}; dropped"); return None
    return {"as_written": aw, "value": v, "unit": u}


def check_schedule(s, page_text, flags, i):
    if not isinstance(s, dict):
        flags.append(f"schedule {i}: not an object"); return None
    url = str(s.get("source_url") or "").strip()
    if url.rstrip("/") not in page_text:
        flags.append(f"schedule {i}: source_url {url!r} is not a saved page; dropped"); return None
    quote = norm(s.get("quote"))
    if not quote or quote not in norm(page_text[url.rstrip("/")]):
        flags.append(f"schedule {i}: quote not found in {url}; dropped"); return None
    out = {"crop": str(s.get("crop") or "other")[:20], "source_url": url, "effective": str(s.get("effective") or "")[:80],
           "quote": str(s.get("quote"))[:1500], "notes": str(s.get("notes") or "")[:200]}
    eff = norm(out["effective"])
    if eff and eff not in quote and eff not in norm(page_text[url.rstrip("/")]):
        flags.append(f"schedule {i}: effective date not on the page; dropped"); out["effective"] = ""
    for k in FIELDS_ONE:
        out[k] = check_num(s.get(k), quote, f"schedule {i} {k}", flags)
    for k in FIELDS_LIST:
        items = s.get(k) if isinstance(s.get(k), list) else []
        kept = []
        for j, it in enumerate(items[:40]):
            if not isinstance(it, dict):
                continue
            th = check_num(it.get("threshold"), quote, f"schedule {i} {k}[{j}] threshold", flags) if it.get("threshold") is not None else None
            dc = check_num(it.get("discount"), quote, f"schedule {i} {k}[{j}] discount", flags)
            if dc is None or (k != "storage" and th is None):
                continue
            kept.append({"threshold": th, "discount": dc, "note": str(it.get("note") or "")[:120]})
        out[k] = kept
    out["numbers"] = sum(out[k] is not None for k in FIELDS_ONE) + sum(len(out[k]) for k in FIELDS_LIST)
    return out


def check(e, a):
    flags = []
    page_text = {p["url"].rstrip("/"): p.get("text") or "" for p in e["pages"]}
    if not isinstance(a, dict):
        return {"company": e["company"], "schedules": [], "no_schedule_reason": "", "flags": ["no answer"]}
    scheds = []
    for i, s in enumerate(a.get("schedules") or []):
        c = check_schedule(s, page_text, flags, i)
        if c:
            scheds.append(c)
    return {"company": e["company"], "schedules": scheds, "no_schedule_reason": str(a.get("no_schedule_reason") or "")[:200],
            "notes": str(a.get("notes") or "")[:200], "flags": flags}


def collect(bundle, results):
    items = results.get("items", {})
    rows = []
    for e in bundle["schedule"]:
        it = items.get(cid_of(e["company"]), {})
        r = check(e, it.get("parsed") if it.get("result") == "succeeded" else None)
        r.update(read=e["read"], label=label(e["company"]), locations=e.get("locations", 0), upperMidwest=e.get("upperMidwest", 0),
                 states=e.get("states", {}), result=it.get("result", "missing"))
        rows.append(r)
    rows.sort(key=lambda r: (-sum(s["numbers"] for s in r["schedules"]), not r["read"], -r["locations"], r["company"]))
    with_s = [r for r in rows if any(s["numbers"] for s in r["schedules"])]
    return {"job": "schedules", "caps": bundle.get("caps"), "batch": results.get("batch_id"), "actual_cost_usd": results.get("actual_cost_usd"),
            "counts": {"sent": len(rows), "notSent": len(bundle.get("nothingToRead", [])), "withNumbers": len(with_s),
                       "read": sum(r["read"] for r in with_s), "schedules": sum(len(r["schedules"]) for r in rows),
                       "shrink": sum(any(s["shrink_per_point"] for s in r["schedules"]) for r in rows),
                       "drying": sum(any(s["drying_per_point"] for s in r["schedules"]) for r in rows),
                       "storage": sum(any(s["storage"] for s in r["schedules"]) for r in rows),
                       "flagged": sum(bool(r["flags"]) for r in rows)},
            "companies": rows, "nothingToRead": bundle.get("nothingToRead", [])}


def fmt(o):
    return "" if not o else o["as_written"]


def markdown(t):
    c = t["counts"]
    L = [f"# Grain discount, shrink, drying and storage schedules ({t.get('caps')})", "",
         f"{c['sent']} companies had a page naming shrink, drying, discounts or storage ({c['notSent']} others had none and were not sent). "
         f"{c['withNumbers']} gave numbers that passed the checks ({c['read']} of them companies we read): shrink {c['shrink']}, drying {c['drying']}, "
         f"storage {c['storage']}. {c['flagged']} answers had something dropped. Batch {t.get('batch')}, cost ${t.get('actual_cost_usd')}.", "",
         "Every number is copied as written and must sit inside its quote, and every quote must be in the saved page it names. "
         "Findings for a person, not published.", "",
         "| Company | Read | Crop | Effective | Base moist. | Shrink/pt | Drying/pt | Drying above | Test weight rows | Storage rows | Source |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in t["companies"]:
        for s in r["schedules"]:
            L.append(f"| {r['label']} | {'yes' if r['read'] else 'no'} | {s['crop']} | {s['effective']} | {fmt(s['base_moisture'])} | "
                     f"{fmt(s['shrink_per_point'])} | {fmt(s['drying_per_point'])} | {fmt(s['drying_above'])} | {len(s['test_weight'])} | "
                     f"{len(s['storage'])} | {s['source_url']} |")
    L += ["", "## Sent, no schedule kept", ""]
    for r in t["companies"]:
        if not r["schedules"]:
            L.append(f"- {r['label']}: {r.get('no_schedule_reason') or r['result']}{' (' + '; '.join(r['flags'][:3]) + ')' if r['flags'] else ''}")
    return "\n".join(L).replace("—", "-") + "\n"


def selftest():
    text = ("Corn Discount Schedule Effective 9/1/2026\nBase moisture 15.0%\nShrink 1.4% per point plus 0.5% handling\n"
            "Drying 4 cents per point above 15.0%\nTest weight below 54 lbs: 2 cents per 1/2 lb\nStorage 3 cents per bushel per month")
    e = {"company": "R:Test Coop", "names": ["Test Coop"], "read": True, "locations": 3, "upperMidwest": 3, "states": {"WI": 3},
         "pages": [{"url": "https://testcoop.com/", "parent": None, "title": "Home", "text": "Welcome"},
                   {"url": "https://testcoop.com/docs/discounts.pdf", "parent": "https://testcoop.com/grain", "pdf": True, "title": "(PDF)", "text": text}]}
    p = prompt(e)
    assert "Company: Test Coop" in p and "(PDF)" in p and "Drying 4 cents" in p
    n = lambda aw, v, u: {"as_written": aw, "value": v, "unit": u}
    good = {"schedules": [{"crop": "corn", "source_url": "https://testcoop.com/docs/discounts.pdf", "effective": "Effective 9/1/2026",
                           "quote": text, "base_moisture": n("15.0%", 15.0, "pct"), "shrink_per_point": n("1.4% per point", 1.4, "pct_per_point"),
                           "shrink_handling": n("0.5% handling", 0.5, "pct"), "drying_per_point": n("4 cents per point", 4, "cents_per_point"),
                           "drying_above": n("above 15.0%", 15.0, "pct"), "drying_flat": None,
                           "test_weight": [{"threshold": n("below 54 lbs", 54, "lbs_per_bu"), "discount": n("2 cents per 1/2 lb", 2, "cents_per_bu"), "note": "per 1/2 lb"}],
                           "damage": [], "foreign_material": [],
                           "storage": [{"threshold": None, "discount": n("3 cents per bushel per month", 3, "cents_per_bu"), "note": "per month"}]}]}
    a = check(e, good)
    s = a["schedules"][0]
    assert not a["flags"], a["flags"]
    assert s["shrink_per_point"]["value"] == 1.4 and s["drying_per_point"]["value"] == 4 and len(s["storage"]) == 1 and s["numbers"] == 7, s
    # a computed or invented number never survives
    bad = json.loads(json.dumps(good))
    bs = bad["schedules"][0]
    bs["drying_per_point"] = n("4 cents per point", 0.04, "dollars_per_point")      # converted: not written
    bs["shrink_per_point"] = n("1.5% per point", 1.5, "pct_per_point")              # not in the quote
    bs["base_moisture"] = n("15.0%", 15.0, "percent")                               # unit not allowed
    bs["test_weight"][0]["threshold"] = n("below 56 lbs", 56, "lbs_per_bu")
    b = check(e, bad)["schedules"][0]
    assert b["drying_per_point"] is None and b["shrink_per_point"] is None and b["base_moisture"] is None and b["test_weight"] == [], b
    assert b["shrink_handling"]["value"] == 0.5
    # a quote that is not on the page, or a page we did not save, drops the schedule
    assert check(e, {"schedules": [dict(good["schedules"][0], quote="Shrink 1.3% per point")]})["schedules"] == []
    assert check(e, {"schedules": [dict(good["schedules"][0], source_url="https://testcoop.com/other.pdf")]})["schedules"] == []
    assert check(e, None)["flags"] == ["no answer"]
    res = {"batch_id": "b", "actual_cost_usd": 1.0, "items": {cid_of(e["company"]): {"result": "succeeded", "parsed": good}}}
    t = collect({"schedule": [e], "caps": "c", "nothingToRead": [{"company": "U:X"}]}, res)
    assert t["counts"]["withNumbers"] == 1 and t["counts"]["shrink"] == 1 and t["counts"]["notSent"] == 1
    md = markdown(t)
    assert "| Test Coop | yes | corn | Effective 9/1/2026 | 15.0% | 1.4% per point | 4 cents per point |" in md, md
    assert "shrink" in trim_text("x" * 50000 + " shrink 1.4% " + "y" * 100, 1000)
    print("schedules selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "bundle":
        caps = os.path.join(a[1], os.environ["SCHEDULES_CAPS"]) if os.environ.get("SCHEDULES_CAPS") else EJ.newest_caps(a[1])
        b = build_bundle(caps)
        os.makedirs(os.path.dirname(a[2]) or ".", exist_ok=True)
        from redact_secrets import redact
        text, n = redact(json.dumps(b))
        open(a[2], "w").write(text)
        print(f"redacted {n} secret-looking string(s) from the captures")
        print(f"::notice title=schedules bundle::{len(b['schedule'])} companies to read, {len(b['nothingToRead'])} with nothing to read, from {b['caps']}")
    elif a[0] == "collect":
        t = collect(json.load(open(a[1])), json.load(open(a[2])))
        os.makedirs(a[3], exist_ok=True)
        json.dump(t, open(os.path.join(a[3], "schedules.json"), "w"), indent=1)
        open(os.path.join(a[3], "schedules.md"), "w").write(markdown(t))
        print(f"::notice title=schedules::{t['counts']}")
    else:
        sys.exit("modes: selftest | bundle CAPS_CLONE OUT | collect BUNDLE RESULTS DIR")
