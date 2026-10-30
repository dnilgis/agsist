#!/usr/bin/env python3
"""
build_ai_answers.py: short, dated answer blocks for the questions farmers ask
search assistants, baked into the page that already owns each topic.

Why: Bing's AI performance export (Oct 28, 2026) lists questions in our lane
that assistants answer without citing us (farm bill status, cattle markets,
the USDA crop report, tariffs, USDA payments, beef supply, screwworm, heifer
retention, Argentina beef). Each answer is 2 to 5 plain sentences, every
number with its primary source and date, in static HTML so a crawler that
runs no JavaScript reads it.

One data file, one block per topic: data/ai-answers.json. Each answer:
  id, page        the page file that owns the topic, and the marker pair
                  <!-- ai-answer:ID --> ... <!-- /ai-answer:ID --> in it
  question        the block's heading, in the words farmers use
  status          "live" (rendered) or "withheld" (markers stay empty)
  withheld_why    for a withheld answer: what is missing, in words
  text            the sentences, plain text (escaped here, no HTML)
  sources         [{name, url, read}]: read = the date we read that copy
  fold            true: a <details> the reader opens (long pages); the text is
                  still in the static HTML
  review_by       the date the answer goes stale (the next report, vote or
                  deadline); scripts/daily_site_check.py lists it after that

The "Last checked" date printed in each block is the OLDEST read date among
its sources, so a block never claims to be fresher than its oldest fact.

arc-plc.html is written whole by scripts/build_arc_plc.py, which calls
render() from here, so both scripts write the same bytes.

    python3 scripts/build_ai_answers.py            # bake every page
    python3 scripts/build_ai_answers.py --check    # exit 1 on drift or a bad answer
    python3 scripts/build_ai_answers.py --stale    # answers past review_by (today, UTC)
    python3 scripts/build_ai_answers.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import html
import json
import os
import re
import sys
import source_links  # noqa: E402  no direct links to data sources
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "ai-answers.json")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
BANNED = ("—", "&mdash;", "&#8212;")
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ID = re.compile(r"^[a-z0-9-]+$")


def nice(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m - 1]} {d}, {y}"


def load(path=DATA):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def problems(doc):
    """Every rule a block must meet. An empty list means the file is good."""
    out, seen = [], set()
    for a in doc.get("answers", []):
        aid = a.get("id", "")
        w = f"answer {aid or '?'}"
        if not ID.match(aid):
            out.append(f"{w}: id must be lowercase letters, digits and hyphens")
        if aid in seen:
            out.append(f"{w}: id used twice")
        seen.add(aid)
        if not a.get("page", "").endswith(".html"):
            out.append(f"{w}: page must be an .html file")
        if not a.get("question"):
            out.append(f"{w}: no question")
        st = a.get("status")
        if st not in ("live", "withheld"):
            out.append(f"{w}: status must be live or withheld")
        if st == "withheld" and not a.get("withheld_why"):
            out.append(f"{w}: a withheld answer says why")
        if not ISO.match(a.get("review_by", "")):
            out.append(f"{w}: review_by must be YYYY-MM-DD")
        blob = json.dumps(a, ensure_ascii=False)
        for b in BANNED:
            if b in blob:
                out.append(f"{w}: em dash")
        if st != "live":
            continue
        text = a.get("text") or []
        if not 2 <= len(text) <= 5:
            out.append(f"{w}: 2 to 5 sentences, has {len(text)}")
        for s in text:
            if "<" in s or ">" in s:
                out.append(f"{w}: plain text only, no markup: {s[:40]}")
        src = a.get("sources") or []
        if not src:
            out.append(f"{w}: no source")
        for s in src:
            if not s.get("name"):
                out.append(f"{w}: a source has no name")
            if not str(s.get("url", "")).startswith("https://"):
                out.append(f"{w}: source {s.get('name')} needs an https link")
            if not ISO.match(str(s.get("read", ""))):
                out.append(f"{w}: source {s.get('name')} needs a read date YYYY-MM-DD")
    return out


def checked(a):
    return min(s["read"] for s in a["sources"])


def render(a):
    """The block between (and including) its markers. Withheld: markers only."""
    aid = a["id"]
    op, cl = f"<!-- ai-answer:{aid} -->", f"<!-- /ai-answer:{aid} -->"
    if a.get("status") != "live":
        return op + cl
    e = html.escape
    srcs = " &middot; ".join(
        source_links.link(s["url"], e(s["name"]), ' rel="noopener" style="text-decoration:underline"')
        for s in a["sources"])
    head = (f'<h2 id="answer-{aid}-h" style="font-size:1.1rem;margin:0 0 .4rem">{e(a["question"])}</h2>')
    body = (f'<p style="margin:0 0 .5rem">{e(" ".join(a["text"]))}</p>'
            f'<p style="margin:0;font-size:.8rem;color:var(--text-muted)">Last checked {nice(checked(a))}. Sources: {srcs}</p>')
    box = 'margin:1rem 0;padding:.8rem 1rem;border:1px solid var(--border);border-radius:8px'
    if a.get("fold"):
        # folded: the answer is in the page (crawlers read it), the reader opens it
        return (f'{op}<details class="ai-answer" id="answer-{aid}" data-checked="{checked(a)}" style="{box.replace("1rem 0;padding:.8rem 1rem", ".5rem 0;padding:.3rem .9rem")}">'
                f'<summary style="cursor:pointer;padding:.35rem 0">{head.replace("<h2 ", "<h2 class=fold-h ", 1).replace("margin:0 0 .4rem", "display:inline;margin:0", 1)}</summary>'
                f'{body}</details>{cl}')
    return (f'{op}<section class="ai-answer" id="answer-{aid}" aria-labelledby="answer-{aid}-h" data-checked="{checked(a)}" '
            f'style="{box}">{head}{body}</section>{cl}')


def by_id(doc):
    return {a["id"]: a for a in doc.get("answers", [])}


def block(aid, doc=None):
    """For page builders (build_arc_plc.py): the rendered block for one id."""
    return render(by_id(doc or load())[aid])


def bake_text(text, answers):
    """Replace each answer's marker pair in one page. Returns (text, missing ids)."""
    missing = []
    for a in answers:
        aid = re.escape(a["id"])
        pat = re.compile(r"<!-- ai-answer:%s -->.*?<!-- /ai-answer:%s -->" % (aid, aid), re.S)
        if not pat.search(text):
            missing.append(a["id"])
            continue
        text = pat.sub(lambda _m, a=a: render(a), text, count=1)
    return text, missing


def run(check=False, root=ROOT, doc=None):
    doc = doc or load(os.path.join(root, "data", "ai-answers.json"))
    bad = problems(doc)
    pages = {}
    for a in doc.get("answers", []):
        pages.setdefault(a["page"], []).append(a)
    drift = []
    for page, answers in sorted(pages.items()):
        path = os.path.join(root, page)
        if not os.path.exists(path):
            bad.append(f"{page}: page not found")
            continue
        with open(path, encoding="utf-8") as f:
            before = f.read()
        after, missing = bake_text(before, answers)
        bad += [f"{page}: no <!-- ai-answer:{m} --> marker pair" for m in missing]
        if after != before:
            drift.append(page)
            if not check:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(after)
    for b in bad:
        print(f"::error::ai-answers: {b}")
    if check and drift:
        for p in drift:
            print(f"::error::ai-answers: {p} is not baked from data/ai-answers.json; run python3 scripts/build_ai_answers.py"
                  + (" (arc-plc.html: python3 scripts/build_arc_plc.py)" if p == "arc-plc.html" else ""))
    live = sum(1 for a in doc.get("answers", []) if a.get("status") == "live")
    print(f"ai-answers: {live} live, {len(doc.get('answers', [])) - live} withheld, "
          f"{len(pages)} pages, {'drift in ' + ', '.join(drift) if drift else 'no drift'}"
          + ("" if check or not drift else " (written)"))
    return 1 if bad or (check and drift) else 0


def stale(doc=None, today=None):
    """Answers whose review_by has passed: [(id, page, review_by)]."""
    today = today or datetime.now(timezone.utc).date().isoformat()
    return [(a["id"], a["page"], a["review_by"]) for a in (doc or load()).get("answers", [])
            if a.get("review_by", "9999") < today]


def selftest():
    ok = True

    def check(c, m):
        nonlocal ok
        if not c:
            ok = False
            print("FAIL", m)
    good = {"id": "t", "page": "p.html", "question": "Q?", "status": "live", "review_by": "2026-11-10",
            "text": ["One & two.", "Three."],
            "sources": [{"name": "USDA <NASS>", "url": "https://x.gov/a?b=1&c=2", "read": "2026-10-18"},
                        {"name": "WASDE", "url": "https://y.gov", "read": "2026-10-16"}]}
    check(problems({"answers": [good]}) == [], "good answer passes")
    h = render(good)
    check(h.startswith("<!-- ai-answer:t --><section") and h.endswith("</section><!-- /ai-answer:t -->"), "markers wrap block")
    f = render(dict(good, fold=True))
    check(f.startswith("<!-- ai-answer:t --><details") and "<summary" in f and "One &amp; two. Three." in f, "folded block keeps the answer in the page")
    check("One &amp; two. Three." in h, "text escaped and joined")
    check("USDA &lt;NASS&gt;" in h and "b=1&amp;c=2" in h, "source escaped")
    check("Last checked Oct 16, 2026." in h, "checked = oldest read date")
    w = dict(good, status="withheld", withheld_why="no source yet")
    check(render(w) == "<!-- ai-answer:t --><!-- /ai-answer:t -->", "withheld renders markers only")
    check(problems({"answers": [dict(good, status="withheld")]}), "withheld needs a reason")
    check(problems({"answers": [dict(good, text=["Only one."])]}), "one sentence fails")
    check(problems({"answers": [dict(good, text=["a — b.", "c."])]}), "em dash fails")
    check(problems({"answers": [dict(good, sources=[])]}), "no source fails")
    check(problems({"answers": [dict(good, sources=[{"name": "x", "url": "http://x", "read": "2026-10-01"}])]}), "http fails")
    check(problems({"answers": [dict(good, sources=[{"name": "x", "url": "https://x"}])]}), "no read date fails")
    check(problems({"answers": [dict(good, text=["<b>x</b>.", "y."])]}), "markup fails")
    check(problems({"answers": [good, good]}), "duplicate id fails")
    page = "a <!-- ai-answer:t -->old<!-- /ai-answer:t --> b"
    t, miss = bake_text(page, [good])
    check(miss == [] and t == "a " + h + " b", "bake replaces between markers")
    check(bake_text(t, [good])[0] == t, "bake is idempotent")
    check(bake_text("no markers", [good])[1] == ["t"], "missing marker reported")
    check(stale({"answers": [good]}, today="2026-11-11") == [("t", "p.html", "2026-11-10")], "stale after review_by")
    check(stale({"answers": [good]}, today="2026-11-10") == [], "not stale on review_by")
    real = load()
    check(problems(real) == [], "data/ai-answers.json passes: %s" % problems(real)[:3])
    print("selftest:", "ok" if ok else "FAILED")
    return 0 if ok else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--stale" in argv:
        rows = stale()
        for aid, page, rb in rows:
            print(f"{aid} on {page}: review by {rb}")
        return 0
    return run(check="--check" in argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
