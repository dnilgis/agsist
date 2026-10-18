#!/usr/bin/env python3
"""FAQ gaps on the tool pages: one Message Batches job (scripts/api_jobs.py, job "faq").

For every tool page tools.html lists, the bundle holds the page's own text, the
FAQ it has now (visible and FAQPage markup), the real search terms that land on
it when we have them (the search bundle on raw, apijobs/r1/input/bundle.json),
and the parts of the references-branch source texts that page cites. The model
proposes up to 3 questions the page does not answer yet, each answered ONLY from
those sources, with the source id and an exact quote.

collect checks every proposal before a person sees it:
  - the source id is one this page was given, and the quote is in that source text
  - every number in the answer is in a quote (a number that is not is a guess)
  - no em or en dashes, plain words, a real question, not a repeat of the page's FAQ
Kept proposals land on raw as apijobs/<run>/faq/proposals.json and proposals.md,
ranked by the search impressions they answer; rejects with reasons beside them.
Nothing here touches a page. The lead adds the accepted ones to the page FAQ and
runs scripts/render_faq_html.py / scripts/bake_faq.py so the markup follows.

  python3 scripts/faq_gaps.py bundle OUT.json [--terms SEARCH_BUNDLE] [--refs GITREF]
  python3 scripts/faq_gaps.py collect BUNDLE RESULTS OUTDIR
  python3 scripts/faq_gaps.py selftest
"""
import html as H
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

MODEL = "claude-opus-5-5"   # writing answers that must stay inside a quote; not a classification job
MAX_TOKENS = 8000           # adaptive thinking plus at most 3 short proposals
EFFORT = "medium"
CAP = 25.0                  # dollars for the whole batch (Sig, Oct 18)
PAGE_CHARS = 14000          # the page's own text sent
SOURCE_CHARS = 110000         # all source excerpts for one page (about 30k tokens)
REF_CHARS = 40000            # any one source
CHUNK = 1400
MAX_PROPOSALS = 3

# Linked from tools.html but not tools: about, contact and the site's own housekeeping.
NOT_TOOLS = {"about", "contact", "data-sources", "sponsor-apply", "status", "changelog", "tools",
             "privacy", "terms", "cookies", "accessibility", "editorial-standards", "disclaimer"}
# Competitor pages fetched for benchmarking, gift guide listings and co-op price pages are not
# sources an answer may rest on (a competitor's wording, a store's price list).
NOT_SOURCES = ("bench-", "gg-", "coop-")

SYSTEM = """You help Sig Lindquist, a Certified Crop Adviser, fill gaps in the FAQ on one tool page of agsist.com, a free farm website. Today is {today}.

You get the page's text, the questions its FAQ already answers, the real search terms that land on the page (when we have them, with impressions), and excerpts of the primary sources the page cites, each with a source id.

Propose up to 3 questions people actually ask about this tool's subject that the page does not answer yet. Fewer is fine. None is fine. Good questions come from the search terms first, then from what a farmer using this tool would plainly ask next.

Hard rules:
- Answer ONLY from the source excerpts given. Not from the page, not from what you know. If the excerpts do not answer it, do not propose it.
- For each answer give the source id and one or two exact quotes copied character for character from that source's excerpt (a sentence or two, under 300 characters each). No ellipses inside a quote.
- Every number in the answer (dollars, percents, dates, years, rates, counts) must appear in one of your quotes. Do not round, convert or add up numbers.
- Do not repeat or reword a question the page already answers.
- Write like Sig: plain farm words, short sentences, a little dry. 1 to 3 sentences, under 500 characters. No em dashes or en dashes. No hype, no "it's important to note", no "navigate", no "delve". Say who the rule comes from ("RMA says", "USDA's rule is") when that helps.
- The question is written the way a farmer would type or say it, ending in a question mark.
- helps lists the search terms (exactly as given) this question answers; empty if none.

Answer with one JSON object in a ```json fenced block and nothing after it:
{{"page": "<page>", "proposals": [{{"q": "...", "a": "...", "sources": [{{"id": "<source id>", "quote": "..."}}], "helps": ["<term>"], "why": "<one line: why people ask this>"}}], "notes": "<one line, e.g. what the sources could not answer>"}}"""

USER = """Page: {url}  (file {page})
Title: {title}

=== QUESTIONS THE PAGE ALREADY ANSWERS ===
{faq}

=== SEARCH TERMS THAT LAND ON THIS PAGE (term | impressions) ===
{terms}

=== THE PAGE'S TEXT ===
{text}

=== SOURCE EXCERPTS (answer only from these) ===
{sources}"""


# ---- building the bundle ----------------------------------------------------

def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def tool_pages(root=ROOT):
    s = (root / "tools.html").read_text(encoding="utf-8")
    main = s[s.find("<main"):s.rfind("</main>")]
    out = []
    for h in re.findall(r'href="/?([a-z0-9-]+)(?:\.html)?(?:[?#][^"]*)?"', main):
        if h not in out and h not in NOT_TOOLS and (root / f"{h}.html").exists():
            out.append(h)
    return out


def page_text(src):
    from render_faq_html import visible_text
    i, j = src.find("<main"), src.rfind("</main>")
    body = src[i:j] if 0 <= i < j else src
    body = re.sub(r"<(nav|footer|header)\b.*?</\1>", " ", body, flags=re.S)
    return visible_text(body)


def page_faq(src):
    from bake_faq import visible_faq
    from render_faq_html import schema_pairs
    out = []
    for q, a in visible_faq(src) + schema_pairs(src):
        if norm(q).lower() not in {x[0].lower() for x in out}:
            out.append((norm(q), norm(a)))
    return out


def title_of(src):
    m = re.search(r"<title>(.*?)</title>", src, re.S)
    return norm(H.unescape(m.group(1))) if m else ""


def git_show(ref, path):
    r = subprocess.run(["git", "-C", str(ROOT), "show", f"{ref}:{path}"], capture_output=True)
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else None


def refs_for(page, src, sources):
    """Sources this page cites: its URL is in the page, or the reference was fetched for it ("why": "/page: ...")."""
    pat = re.compile(r"(?<![\w/-])/" + re.escape(page) + r"(?![\w-])")
    cited, fetched = [], []
    for e in sources:
        if e.get("status") == "failed" or not e.get("saved_as"):
            continue    # missing or old copy: never quote it
        if e["id"].startswith(NOT_SOURCES):
            continue
        urls = [u for u in (e.get("url"), e.get("final_url")) if u]
        if any(u in src or H.escape(u) in src for u in urls):
            cited.append(e)
        elif pat.search(e.get("why") or "") and "benchmark" not in (e.get("why") or "").lower():
            fetched.append(e)
    return cited + fetched     # what the page links first


def words(s):
    return {w for w in re.findall(r"[a-z]{4,}", s.lower())}


def excerpt(text, keys, budget):
    """The chunks of a source most about this page, in document order, up to budget characters."""
    paras, cur = [], ""
    for para in re.split(r"\n\s*\n", text):
        if len(cur) + len(para) > CHUNK and cur:
            paras.append(cur); cur = ""
        cur += para.rstrip() + "\n\n"
        while len(cur) > CHUNK * 2:
            paras.append(cur[:CHUNK]); cur = cur[CHUNK:]
    if cur.strip():
        paras.append(cur)
    if sum(len(p) for p in paras) <= budget:
        return "".join(paras).strip()
    scored = sorted(range(len(paras)), key=lambda i: (-len(words(paras[i]) & keys), i))
    keep, used = set(), 0
    for i in [0] + scored:                     # the first chunk names the document
        if i in keep or used + len(paras[i]) > budget:
            continue
        keep.add(i); used += len(paras[i])
    return "\n[...]\n".join(paras[i].strip() for i in sorted(keep))


def build_entry(page, src, refs_ref, sources, terms):
    title = title_of(src)
    faq = page_faq(src)
    refs = refs_for(page, src, sources)
    keys = words(title + " " + " ".join(q for q, _ in faq) + " " + " ".join(t["q"] for t in terms)) | {page.replace("-", "")}
    keys |= set(page.split("-"))
    out, used = [], 0
    for e in refs:
        if used >= SOURCE_CHARS:
            break
        t = git_show(refs_ref, f"refs/{e['id']}.txt")
        if not t or len(t.strip()) < 200:
            continue
        x = excerpt(t, keys, min(REF_CHARS, SOURCE_CHARS - used))
        if len(x) < 200:
            continue
        out.append({"id": e["id"], "title": e.get("title", ""), "url": e.get("url", ""),
                    "fetched_utc": e.get("fetched_utc") or e.get("checked_utc"), "text": x})
        used += len(x)
    return {"page": page, "url": f"https://agsist.com/{page}", "title": title,
            "faq": [q for q, _ in faq], "terms": terms[:30], "text": page_text(src)[:PAGE_CHARS], "sources": out}


def terms_by_page(path):
    if not path or not Path(path).exists():
        return {}
    b = json.load(open(path))
    out = {}
    for e in b.get("search", []):
        out[e["page"].removesuffix(".html")] = [
            {"q": t["q"], "impressions": int(t.get("google", 0) + t.get("bing", 0)), "weight": float(t.get("weight", 0))}
            for t in e.get("terms", [])]
    return out


def cmd_bundle(out_path, terms_path=None, refs_ref="origin/references"):
    idx = git_show(refs_ref, "index.json")
    if not idx:
        sys.exit(f"::error::cannot read {refs_ref}:index.json (fetch the references branch first)")
    sources = json.loads(idx)["sources"]
    terms = terms_by_page(terms_path)
    rows, skipped = [], []
    for page in tool_pages():
        src = (ROOT / f"{page}.html").read_text(encoding="utf-8")
        e = build_entry(page, src, refs_ref, sources, terms.get(page, []))
        if not e["sources"]:
            skipped.append(page)
            continue
        rows.append(e)
    b = {"today": time.strftime("%B %-d, %Y"), "built_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "job": "faq-gaps", "faq": rows, "faq_skipped_no_sources": skipped}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    json.dump(b, open(out_path, "w"), ensure_ascii=False)
    print(f"faq bundle: {len(rows)} pages with sources, {len(skipped)} with none ({', '.join(skipped)}); "
          f"{sum(len(r['sources']) for r in rows)} sources, {Path(out_path).stat().st_size // 1024} KB")


# ---- the request ------------------------------------------------------------

def params(e, today):
    faq = "\n".join(f"- {q}" for q in e["faq"]) or "(none)"
    terms = "\n".join(f"{t['q']} | {t['impressions']}" for t in e["terms"]) or "(none on hand for this page)"
    srcs = "\n\n".join(f"--- source id: {s['id']} ---\nTitle: {s['title']}\nURL: {s['url']}\n{s['text']}" for s in e["sources"])
    return {"model": MODEL, "max_tokens": MAX_TOKENS,
            "thinking": {"type": "adaptive"}, "output_config": {"effort": EFFORT},
            "system": SYSTEM.format(today=today),
            "messages": [{"role": "user", "content": USER.format(
                url=e["url"], page=e["page"], title=e["title"], faq=faq, terms=terms, text=e["text"] or "(empty)",
                sources=srcs)}]}


def cid_of(page):
    return ("q_" + re.sub(r"[^a-zA-Z0-9_-]", "_", page))[:64]


# ---- checking what comes back -----------------------------------------------

DASHES = "—–‒―"
AI_TELLS = ("it's important to note", "it is important to note", "navigate", "delve", "in conclusion",
            "rest assured", "game-changer", "unlock", "leverage", "seamless", "crucial to")
NUM = re.compile(r"\d+(?:[,.]\d+)*")
NUM_WORDS = re.compile(r"\b(half|quarter|third|hundred|thousand|million|billion|dozen|percent|twice|double|triple)\b", re.I)


def qnorm(s):
    s = H.unescape(s)
    s = s.translate({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0x2010: "-", 0x2011: "-",
                     0x2012: "-", 0x2013: "-", 0x2014: "-", 0x00A0: " ", 0xFB01: "fi", 0xFB02: "fl"})
    return re.sub(r"\s+", " ", s).strip().lower()


def in_source(quote, text):
    q, t = qnorm(quote), qnorm(text)
    if q in t:
        return True
    dehy = lambda x: re.sub(r"(\w)- (\w)", r"\1\2", x)   # pdftotext breaks words at line ends
    return dehy(q) in dehy(t)


def numbers(s):
    out = set()
    for n in NUM.findall(s):
        n = n.replace(",", "")
        out.add(n)
        if "." in n:
            out.add(n.rstrip("0").rstrip("."))
    return out


def similar(a, b):
    x, y = words(a), words(b)
    return bool(x and y) and len(x & y) / len(x | y) >= 0.6


def check(entry, p):
    """Reasons to refuse one proposal; empty means keep."""
    why = []
    q, a = (p.get("q") or "").strip(), (p.get("a") or "").strip()
    srcs = p.get("sources") or []
    if not q.endswith("?"):
        why.append("question does not end in ?")
    if len(a) < 25 or len(a) > 700:
        why.append(f"answer length {len(a)}")
    if any(d in q + a for d in DASHES):
        why.append("em or en dash")
    low = (q + " " + a).lower()
    tell = [t for t in AI_TELLS if t in low]
    if tell:
        why.append(f"AI-sounding: {tell[0]}")
    if any(similar(q, f) for f in entry["faq"]):
        why.append("the page already answers this")
    given = {s["id"]: s["text"] for s in entry["sources"]}
    if not srcs:
        why.append("no source quote")
    quotes = []
    for s in srcs:
        sid, quote = s.get("id", ""), (s.get("quote") or "").strip()
        if sid not in given:
            why.append(f"source {sid!r} was not given for this page")
        elif len(quote) < 15 or "..." in quote or "…" in quote:
            why.append(f"quote from {sid} too short or cut")
        elif not in_source(quote, given[sid]):
            why.append(f"quote not found in {sid}")
        else:
            quotes.append(quote)
    have = set().union(*(numbers(x) for x in quotes)) if quotes else set()
    miss = sorted(n for n in numbers(a) if n not in have)
    if miss:
        why.append("numbers not in the quote: " + ", ".join(miss[:5]))
    qw = {w.lower() for x in quotes for w in NUM_WORDS.findall(x)}
    extra = sorted({w.lower() for w in NUM_WORDS.findall(a)} - qw)
    if extra:
        why.append("amount words not in the quote: " + ", ".join(extra))
    return why


def cmd_collect(bundle_path, results_path, outdir):
    b = json.load(open(bundle_path))
    res = json.load(open(results_path))
    by_cid = {cid_of(e["page"]): e for e in b.get("faq", [])}
    kept, rejected, no_answer = [], [], []
    for cid, item in res.get("items", {}).items():
        e = by_cid.get(cid)
        if not e:
            continue
        parsed = item.get("parsed")
        if item.get("result") != "succeeded" or not isinstance(parsed, dict):
            no_answer.append({"page": e["page"], "result": item.get("result"), "stop_reason": item.get("stop_reason")})
            continue
        weight = {t["q"]: t["weight"] or t["impressions"] for t in e["terms"]}
        for n, p in enumerate((parsed.get("proposals") or [])):
            if not isinstance(p, dict):
                continue
            why = check(e, p) if n < MAX_PROPOSALS else ["over the 3 per page limit"]
            helps = [t for t in (p.get("helps") or []) if t in weight]
            row = {"page": e["page"], "q": p.get("q"), "a": p.get("a"), "sources": p.get("sources"),
                   "helps": helps, "score": round(sum(weight[t] for t in helps)), "why": p.get("why"),
                   "source_urls": {s["id"]: s["url"] for s in e["sources"]}}
            (rejected if why else kept).append({**row, **({"rejected_for": why} if why else {})})
    kept.sort(key=lambda r: (-r["score"], r["page"]))
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    meta = {"run": res.get("run"), "batch_id": res.get("batch_id"), "actual_cost_usd": res.get("actual_cost_usd"),
            "pages": len(by_cid), "kept": len(kept), "rejected": len(rejected), "no_answer": no_answer,
            "note": "Proposals, not page copy. Check each against its source before it goes on a page; then add it to the "
                    "page's FAQ and run scripts/render_faq_html.py and scripts/bake_faq.py."}
    json.dump({**meta, "proposals": kept}, open(out / "proposals.json", "w"), indent=1, ensure_ascii=False)
    json.dump({**meta, "rejected": rejected}, open(out / "rejected.json", "w"), indent=1, ensure_ascii=False)
    md = [f"# FAQ gap proposals ({len(kept)} kept, {len(rejected)} rejected, {len(by_cid)} pages)", "",
          meta["note"], "", "Ranked by the search impressions each answers (0 = no search data for it).", ""]
    for i, r in enumerate(kept, 1):
        md += [f"## {i}. /{r['page']}: {r['q']}", "", r["a"], ""]
        for s in r["sources"]:
            md.append(f"- Source `{s['id']}` ({r['source_urls'].get(s['id'], '')}): \"{s['quote']}\"")
        md += [f"- Answers: {', '.join(r['helps']) or '(no search term)'}; score {r['score']}", f"- Why: {r['why']}", ""]
    if rejected:
        md += ["## Rejected", ""] + [f"- /{r['page']}: {r['q']} ({'; '.join(r['rejected_for'])})" for r in rejected]
    (out / "proposals.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"::notice title=FAQ gaps::{len(kept)} proposals kept, {len(rejected)} rejected, {len(no_answer)} pages with no usable answer")


# ---- offline checks -----------------------------------------------------------

def selftest():
    src = "Premium is due at the end of the period. The producer premium share is 35 percent at 95% coverage, set by RMA in 2026."
    e = {"page": "lrp", "url": "https://agsist.com/lrp", "title": "LRP", "faq": ["What is LRP insurance?"],
         "terms": [{"q": "lrp premium due", "impressions": 40, "weight": 50.0}], "text": "LRP calculator",
         "sources": [{"id": "rma-lrp", "title": "LRP", "url": "https://rma.example/lrp.pdf", "fetched_utc": "x", "text": src}]}
    good = {"q": "When is the LRP premium due?", "a": "At the end of the period. RMA set 95% coverage in 2026.",
            "sources": [{"id": "rma-lrp", "quote": "Premium is due at the end of the period. The producer premium share is 35 percent at 95% coverage, set by RMA in 2026."}],
            "helps": ["lrp premium due"]}
    assert check(e, good) == [], check(e, good)
    bad_num = {**good, "a": "At the end of the period, and the share is 40% at 95% coverage."}
    assert any("40" in w for w in check(e, bad_num)), check(e, bad_num)
    assert "em or en dash" in check(e, {**good, "a": good["a"].replace(". RMA", " — RMA")})
    assert any("not found" in w for w in check(e, {**good, "sources": [{"id": "rma-lrp", "quote": "Premium is due at signup and never later."}]}))
    assert any("not given" in w for w in check(e, {**good, "sources": [{"id": "other", "quote": "Premium is due at the end."}]}))
    assert "the page already answers this" in check(e, {**good, "q": "What is LRP insurance?"})
    assert any("amount words" in w for w in check(e, {**good, "a": "At the end of the period; about half pay early in 2026 at 95%."}))
    assert in_source("producer pre- mium share", "The producer pre-\nmium share") and in_source("Premium is DUE", src)
    assert numbers("$1,234.50 and 7.0%") == {"1234.50", "1234.5", "7.0", "7"}
    p = params(e, "October 18, 2026")
    assert p["model"] == MODEL and p["thinking"] == {"type": "adaptive"} and "temperature" not in p
    assert "budget_tokens" not in json.dumps(p) and "rma-lrp" in p["messages"][0]["content"]
    assert "lrp premium due | 40" in p["messages"][0]["content"] and cid_of("grain-emc") == "q_grain-emc"
    long = "\n\n".join(f"Paragraph {i} about " + ("corn moisture shrink " if i == 7 else "nothing much here ") * 60 for i in range(40))
    x = excerpt(long, {"moisture", "shrink"}, 4000)
    assert "Paragraph 7 " in x and "Paragraph 0 " in x and len(x) < 4400, len(x)
    assert refs_for("lrp", "<a href='https://rma.example/lrp.pdf'>", [{"id": "a", "url": "https://rma.example/lrp.pdf", "saved_as": "refs/a.pdf"},
                                                                     {"id": "b", "url": "u", "why": "/lrp: x", "saved_as": "refs/b.pdf"},
                                                                     {"id": "c", "url": "v", "why": "/lrp-other: x", "saved_as": "y"},
                                                                     {"id": "d", "url": "https://rma.example/lrp.pdf", "status": "failed", "saved_as": "z"}]) \
        == [{"id": "a", "url": "https://rma.example/lrp.pdf", "saved_as": "refs/a.pdf"}, {"id": "b", "url": "u", "why": "/lrp: x", "saved_as": "refs/b.pdf"}]
    # collect: one good, one bad, ranked and written out
    import tempfile
    d = Path(tempfile.mkdtemp())
    json.dump({"faq": [e]}, open(d / "b.json", "w"))
    json.dump({"run": "t", "items": {"q_lrp": {"result": "succeeded", "parsed": {"proposals": [good, bad_num]}}}}, open(d / "r.json", "w"))
    cmd_collect(d / "b.json", d / "r.json", d / "out")
    pj = json.load(open(d / "out/proposals.json"))
    assert pj["kept"] == 1 and pj["rejected"] == 1 and pj["proposals"][0]["score"] == 50
    assert "When is the LRP premium due?" in (d / "out/proposals.md").read_text()
    pages = tool_pages()
    assert "grain-emc" in pages and "about" not in pages and "contact" not in pages, pages
    print(f"faq_gaps selftest ok ({len(pages)} tool pages)")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "selftest":
        selftest()
    elif a[0] == "bundle":
        def opt(flag, default=None):
            return a[a.index(flag) + 1] if flag in a else default
        cmd_bundle(a[1], opt("--terms"), opt("--refs", "origin/references"))
    elif a[0] == "collect":
        cmd_collect(a[1], a[2], a[3])
    else:
        sys.exit("modes: selftest | bundle OUT [--terms F] [--refs REF] | collect BUNDLE RESULTS OUTDIR")
