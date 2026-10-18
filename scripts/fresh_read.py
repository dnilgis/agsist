#!/usr/bin/env python3
"""First-time visitor read of the hand-made pages (api_jobs.py job kind "fresh").

A reader who has never seen agsist.com lands on one page from a search and is
not a farm expert. For each page the model says what they think the page is for
in 5 seconds, the first confusing line, jargon left unexplained, whether "what
is this / who made it / where the numbers come from" is answered, dead ends, and
the single best fix with exact wording. Nothing here touches a page: the report
is a to-do for the lead.

  bundle RENDER.json TRAFFIC.json OUT.json   build the input from a local render
                                             (rendered text, scripts stripped;
                                             menu and footer once, in the system
                                             prompt) and the traffic weights
  report BUNDLE RESULTS OUTDIR               ranked fresh-read.json + fresh-read.md:
                                             pages by traffic, then the site-wide
                                             repeated problems. Quotes are checked
                                             against the page text; a fix that
                                             adds a number the page does not
                                             already show is marked, never trusted
  selftest
"""
import collections
import json
import re
import sys
import time

MODEL = "claude-opus-5-5"     # judgment and exact wording, not a classification
MAX_TOKENS = 8000
EFFORT = "medium"
CAP = 20.0                    # dollars (Sig, Oct 18)
PAGE_CHARS = 30000            # page text sent: the first 26,000 and the last 4,000 characters
PROBLEMS = ("unclear_purpose", "jargon", "no_what_is_this", "no_who_made_it", "no_data_source",
            "dead_end", "first_screen_clutter", "trust", "other")

SYSTEM = """You read one page of agsist.com, a free farm website, as a first-time visitor. Today is {today}.

Who you are: you have never seen this site. You typed a question into a search engine and this page came up, so you arrived on it directly, not from the home page. You are not a farm expert: you might be a landowner, a new or part-time farmer, a farm spouse or child helping out, a lender, a student, a reporter, or a town person curious about crops or prices. You know everyday words but not trade terms (basis, ARC-CO, EMC, GDU, PRF, carry, managed money, WASDE, shrink) unless the page explains them.

You get the page as rendered text with scripts removed: the title and meta description, what fits on the first screen on a desktop (1280x800) and on a phone (390x844) before scrolling, then the whole main content. Links look like [text](/path), buttons like [button: text], form fields like [field: label], choices like [choose: label = current], open/close sections like [open/close] question, graphics like [graphic] or [chart]. Calculators and live tables may show placeholders because live prices did not load in this copy; do not count a placeholder or an empty live number as a problem unless the page gives no hint of what will appear there.

Every page has the same site menu at the top and the same footer. They are not repeated in each page text; here they are once:
=== SITE MENU (top bar; the dropdowns hold these links) ===
{menu}
=== FOOTER ===
{footer}

Judge only what a first-time visitor sees. Answer:
1. five_seconds: in one plain sentence, what you think this page is for after 5 seconds on the first screen. five_seconds_right: "yes" if that matches what the page actually does, "partly", or "no".
2. first_confusing: the first word or line that would stop you, quoted exactly from the page text, and why. Empty quote if nothing on the first screen confuses you.
3. jargon: up to 6 terms used without a plain explanation where they first appear, each with the exact quote where it first appears and "explained_later" true if the page explains it further down.
4. basics: for each of what_is_this (what the page or tool is and what it answers), who_made_it (a person or a group stands behind it), data_source (where the numbers or facts come from and how fresh they are): "clear" (a visitor would see it without hunting), "buried" (present but far down or hard to spot), or "missing", with the exact quote when present.
5. dead_ends: places where a visitor finishes (reads the answer, gets a result, reaches the end) and has no obvious next step. Say where and what next step would fit. Use the related links and the menu only if a visitor would notice them at that point.
6. best_fix: the single change that would help a first-time visitor most. Give where it goes, the exact current text it replaces (quoted exactly, or empty when it is new), and the exact new wording ready to paste.
7. other_fixes: up to 3 more, the same shape.
8. problems: tags for what you found, from: {problems}.

Rules for new wording:
- Plain farm words, short sentences, the way a neighbor who knows the subject would say it. No em dashes. Nothing that sounds like an ad or a chatbot. No store or company names.
- Never invent a number, price, date, percentage or statistic. Use only numbers already on the page; otherwise say what to show in words ("the date of the next report").
- Never invent a source or a credential. If the page names its sources or author, you may move or repeat them; if it does not, say "name the source here" in brackets.
- Every quote must be copied exactly from the page text you were given.

Answer with one JSON object in a ```json fenced block and nothing after it:
{{"page": "<file>", "five_seconds": "...", "five_seconds_right": "yes|partly|no", "first_confusing": {{"quote": "...", "why": "..."}}, "jargon": [{{"term": "...", "quote": "...", "explained_later": false}}], "basics": {{"what_is_this": {{"status": "clear|buried|missing", "quote": "..."}}, "who_made_it": {{"status": "clear|buried|missing", "quote": "..."}}, "data_source": {{"status": "clear|buried|missing", "quote": "..."}}}}, "dead_ends": [{{"where": "...", "next_step": "..."}}], "best_fix": {{"where": "...", "current": "...", "new": "...", "why": "..."}}, "other_fixes": [{{"where": "...", "current": "...", "new": "...", "why": "..."}}], "problems": ["..."]}}"""

USER = """Page: {url}  (file {page})
Title: {title}
Meta description: {meta}

=== DESKTOP FIRST SCREEN (1280x800, before scrolling; includes the menu bar) ===
{desktop}

=== PHONE FIRST SCREEN (390x844, before scrolling; includes the menu bar) ===
{phone}

=== WHOLE MAIN CONTENT ===
{text}"""


def clip(t, n=PAGE_CHARS):
    t = t or ""
    return t if len(t) <= n else t[:n - 4000] + "\n\n[... middle of the page left out ...]\n\n" + t[-4000:]


def params(e, site, today):
    return {
        "model": MODEL, "max_tokens": MAX_TOKENS,
        "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT},
        # the same system block on every request: cache it
        "system": [{"type": "text", "cache_control": {"type": "ephemeral"},
                    "text": SYSTEM.format(today=today, menu=site.get("menu") or "(none)",
                                          footer=site.get("footer") or "(none)", problems=", ".join(PROBLEMS))}],
        "messages": [{"role": "user", "content": USER.format(
            url=e["url"], page=e["page"], title=e.get("title", ""), meta=e.get("meta", ""),
            desktop=e.get("desktop") or "(empty)", phone=e.get("phone") or "(empty)", text=clip(e.get("text")) or "(empty)")}],
    }


def cid_of(page):
    return ("v_" + re.sub(r"[^a-zA-Z0-9_-]", "_", page))[:64]


def requests(bundle):
    today = bundle.get("today") or time.strftime("%B %-d, %Y")
    site = bundle.get("site", {})
    return [("fresh", cid_of(e["page"]), e["page"], params(e, site, today)) for e in bundle.get("fresh", [])]


def url_of(page):
    p = re.sub(r"(^|/)index\.html$", r"\1", page)
    return "https://agsist.com/" + re.sub(r"\.html$", "", p)


def cmd_bundle(render_path, traffic_path, out_path):
    r = json.load(open(render_path))
    t = json.load(open(traffic_path))
    m = r.get("__menu", {})
    menu = (m.get("nav", "") + "\nMenu links: " + m.get("drawer", "")).strip()
    rows, skipped = [], []
    for page, row in r.items():
        if page.startswith("__"):
            continue
        if row.get("error") or not (row.get("main") or "").strip():
            skipped.append({"page": page, "why": row.get("error") or "no text"}); continue
        w = t.get("pages", {}).get(page, {})
        rows.append({"page": page, "url": url_of(page), "title": row.get("title", ""), "meta": row.get("meta", ""),
                     "desktop": row.get("desktop", ""), "phone": row.get("phone", ""), "text": row["main"],
                     "traffic": {k: w.get(k, 0) for k in ("weight", "gsc_clicks", "gsc_impressions", "bing_impressions", "bing_ai_citations")}})
    rows.sort(key=lambda e: (-e["traffic"]["weight"], e["page"]))
    b = {"job": "fresh", "today": time.strftime("%B %-d, %Y"), "rev": r.get("__rev", ""),
         "traffic_source": t.get("source", ""), "site": {"menu": menu, "footer": m.get("footer", "")},
         "fresh": rows, "skipped": skipped}
    json.dump(b, open(out_path, "w"), indent=1)
    print(f"{len(rows)} pages in {out_path}; skipped {len(skipped)}: {[s['page'] for s in skipped]}")


def norm(s):
    return re.sub(r"\s+", " ", (s or "").replace("’", "'").replace("“", '"').replace("”", '"')).strip().lower()


def page_blob(e):
    return norm(" ".join([e.get("title", ""), e.get("meta", ""), e.get("desktop", ""), e.get("phone", ""), e.get("text", "")]))


def numbers_in(s):
    return set(re.findall(r"\d+(?:[.,]\d+)*", s or ""))


def check(e, p):
    """Flags on one parsed answer: quotes not found on the page, new wording with numbers the page does not show, em dashes."""
    blob, nums = page_blob(e), numbers_in(" ".join([e.get("title", ""), e.get("meta", ""), e.get("text", ""), e.get("desktop", "")]))
    flags = []
    quotes = [("first_confusing", (p.get("first_confusing") or {}).get("quote"))]
    quotes += [(f"jargon:{j.get('term')}", j.get("quote")) for j in p.get("jargon") or []]
    quotes += [(f"basics:{k}", (v or {}).get("quote")) for k, v in (p.get("basics") or {}).items()]
    fixes = [p.get("best_fix") or {}] + list(p.get("other_fixes") or [])
    quotes += [(f"fix{i}.current", f.get("current")) for i, f in enumerate(fixes)]
    for where, q in quotes:
        if q and norm(q) not in blob:
            flags.append(f"quote not found on the page ({where}): {q[:80]}")
    for i, f in enumerate(fixes):
        new = f.get("new") or ""
        extra = sorted(numbers_in(new) - nums)
        if extra:
            flags.append(f"fix{i} adds numbers the page does not show: {', '.join(extra)}")
        if "\u2014" in new:
            flags.append(f"fix{i} has an em dash")
    return flags


def cmd_report(bundle_path, results_path, outdir):
    import os
    b = json.load(open(bundle_path))
    res = json.load(open(results_path))
    items = res.get("items", {})
    pages, failed = [], []
    prob, jarg, basics = collections.Counter(), collections.defaultdict(set), collections.defaultdict(list)
    dead, wrong5 = [], []
    for rank, e in enumerate(b["fresh"], 1):
        it = items.get(cid_of(e["page"])) or {}
        p = it.get("parsed")
        if not p:
            failed.append({"page": e["page"], "result": it.get("result", "missing"), "stop_reason": it.get("stop_reason")}); continue
        flags = check(e, p)
        for t in set(p.get("problems") or []):
            prob[t if t in PROBLEMS else "other"] += 1
        for j in p.get("jargon") or []:
            if j.get("term"):
                jarg[norm(j["term"])].add(e["page"])
        for k, v in (p.get("basics") or {}).items():
            if (v or {}).get("status") in ("missing", "buried"):
                basics[k].append((e["page"], v["status"]))
        if p.get("dead_ends"):
            dead.append(e["page"])
        if p.get("five_seconds_right") in ("no", "partly"):
            wrong5.append((e["page"], p.get("five_seconds_right")))
        pages.append({"rank": rank, "page": e["page"], "url": e["url"], "traffic": e["traffic"], "flags": flags, "read": p})
    n = len(pages)
    site = {
        "pages_read": n, "pages_failed": len(failed),
        "problem_counts": dict(prob.most_common()),
        "basics_missing_or_buried": {k: {"missing": sum(1 for _, s in v if s == "missing"), "buried": sum(1 for _, s in v if s == "buried"),
                                         "pages": [pg for pg, _ in v]} for k, v in basics.items()},
        "jargon_on_3_or_more_pages": {t: sorted(v) for t, v in sorted(jarg.items(), key=lambda x: -len(x[1])) if len(v) >= 3},
        "pages_with_dead_ends": dead,
        "five_seconds_not_right": [{"page": pg, "verdict": v} for pg, v in wrong5],
    }
    out = {"run": res.get("run"), "batch_id": res.get("batch_id"), "rev": b.get("rev"), "actual_cost_usd": res.get("actual_cost_usd"),
           "ranked_by": "traffic weight = Google impressions + Bing impressions + Bing AI citations (" + b.get("traffic_source", "") + ")",
           "site": site, "pages": pages, "failed": failed}
    os.makedirs(outdir, exist_ok=True)
    json.dump(out, open(f"{outdir}/fresh-read.json", "w"), indent=1)
    open(f"{outdir}/fresh-read.md", "w").write(markdown(out))
    print(f"{n} pages read, {len(failed)} failed, {sum(1 for p in pages if p['flags'])} with flags -> {outdir}/fresh-read.md")


def markdown(o):
    s = o["site"]
    L = [f"# First-time visitor read ({o.get('run')})", "",
         f"{s['pages_read']} pages read, {s['pages_failed']} failed. Cost ${o.get('actual_cost_usd')}. Site at {o.get('rev', '')[:10]}.",
         f"Ranked by {o['ranked_by']}.", "", "Findings only. Check each fix on the page before applying; lines marked FLAG failed a check.", "",
         "## Site-wide repeated problems", ""]
    for t, c in s["problem_counts"].items():
        L.append(f"- {t}: {c} of {s['pages_read']} pages")
    L += ["", "### What is this / who made it / where the data comes from", ""]
    for k, v in s["basics_missing_or_buried"].items():
        L.append(f"- {k}: missing on {v['missing']}, buried on {v['buried']}: {', '.join(v['pages'][:25])}{' ...' if len(v['pages']) > 25 else ''}")
    L += ["", "### Jargon left unexplained on 3 or more pages", ""]
    for t, pg in list(s["jargon_on_3_or_more_pages"].items())[:30]:
        L.append(f"- {t} ({len(pg)}): {', '.join(pg)}")
    L += ["", f"### Dead ends on {len(s['pages_with_dead_ends'])} pages", "", ", ".join(s["pages_with_dead_ends"]), "",
          "### First 5 seconds miss the point", ""]
    L += [f"- {x['page']}: {x['verdict']}" for x in s["five_seconds_not_right"]]
    L += ["", "## Pages, most traffic first", ""]
    for p in o["pages"]:
        r, t = p["read"], p["traffic"]
        fc, bf = r.get("first_confusing") or {}, r.get("best_fix") or {}
        L += [f"### {p['rank']}. {p['page']} (weight {t.get('weight', 0):g}, {t.get('gsc_clicks', 0):g} Google clicks)", "",
              f"- 5 seconds ({r.get('five_seconds_right')}): {r.get('five_seconds')}",
              f"- First confusing: \"{fc.get('quote', '')}\" {fc.get('why', '')}",
              "- Jargon: " + "; ".join(f"{j.get('term')}{' (explained later)' if j.get('explained_later') else ''}" for j in r.get("jargon") or []),
              "- Basics: " + "; ".join(f"{k} {(v or {}).get('status')}" for k, v in (r.get("basics") or {}).items()),
              "- Dead ends: " + ("; ".join(f"{d.get('where')} -> {d.get('next_step')}" for d in r.get("dead_ends") or []) or "none"),
              f"- Best fix ({bf.get('where', '')}): replace \"{bf.get('current', '')}\" with \"{bf.get('new', '')}\". {bf.get('why', '')}"]
        for f in r.get("other_fixes") or []:
            L.append(f"- Also ({f.get('where', '')}): \"{f.get('current', '')}\" -> \"{f.get('new', '')}\"")
        L += [f"- FLAG: {x}" for x in p["flags"]]
        L.append("")
    if o["failed"]:
        L += ["## Failed", ""] + [f"- {f['page']}: {f['result']} {f.get('stop_reason') or ''}" for f in o["failed"]]
    return "\n".join(L) + "\n"


def selftest():
    e = {"page": "grain-emc.html", "url": url_of("grain-emc.html"), "title": "Grain EMC", "meta": "m",
         "desktop": "When to run aeration fans", "phone": "When", "text": "x" * 40000 + " Fan heat is 2 to 5 F. EMC means the moisture grain settles at.",
         "traffic": {"weight": 5}}
    site = {"menu": "Markets; Crop & Field", "footer": "About; Contact"}
    rq = requests({"today": "October 18, 2026", "site": site, "fresh": [e]})
    assert rq[0][:3] == ("fresh", "v_grain-emc_html", "grain-emc.html")
    p = rq[0][3]
    assert p["model"] == MODEL and p["thinking"] == {"type": "adaptive"} and "temperature" not in p and "budget_tokens" not in json.dumps(p)
    assert "Crop & Field" in p["system"][0]["text"] and p["system"][0]["cache_control"]["type"] == "ephemeral"
    u = p["messages"][0]["content"]
    assert "middle of the page left out" in u and "Fan heat is 2 to 5 F" in u and len(u) < PAGE_CHARS + 2000
    assert url_of("rent/index.html") == "https://agsist.com/rent/" and url_of("tools.html") == "https://agsist.com/tools"
    assert "\u2014" not in SYSTEM and "\u2014" not in USER
    good = {"first_confusing": {"quote": "Fan heat is 2 to 5 F."}, "jargon": [{"term": "EMC", "quote": "EMC means"}],
            "basics": {"who_made_it": {"status": "missing", "quote": ""}},
            "best_fix": {"current": "", "new": "Fans add 2 to 5 F of heat."}, "other_fixes": []}
    assert check(e, good) == [], check(e, good)
    bad = {"first_confusing": {"quote": "not on the page"}, "best_fix": {"new": "Corn dries 3 points a day \u2014 fast."}}
    f = check(e, bad)
    assert any("quote not found" in x for x in f) and any("numbers" in x and "3" in x for x in f) and any("em dash" in x for x in f), f
    print("fresh_read selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "bundle":
        cmd_bundle(*a[1:4])
    elif a[0] == "report":
        cmd_report(*a[1:4])
    else:
        sys.exit("modes: selftest | bundle RENDER TRAFFIC OUT | report BUNDLE RESULTS OUTDIR")
