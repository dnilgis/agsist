#!/usr/bin/env python3
"""
AGSIST — regenerate FAQPage structured data FROM the visible FAQ.

WHY THIS EXISTS
The 2026-08-16 sweep found six pages whose FAQPage markup describes a page that
does not exist. On /basis, Google is told the page answers

    "Is basis set by my local elevator?"

which appears nowhere on it, while the question the page does answer

    "Is my elevator ripping me off?"

is absent from the markup. On /conditions and /foreign-land the two lists share
no questions at all.

Google requires FAQPage content to be visible on the page. Six pages were
risking their rich result, and the cause is the obvious one: the JSON-LD was
hand-written once and the visible copy was edited afterwards. Two hand-written
copies of one fact, which is the failure mode this site keeps relearning.

So the page becomes the source of truth and the structured data is derived. The
visible questions are also simply better writing -- "Is my elevator ripping me
off?" is what a farmer types; "Is basis set by my local elevator?" is what a
committee writes.

ORDER OF OPERATIONS
build_condyield.py and build_croptour.py bake live numbers INTO visible FAQ
answers. This script must run AFTER them, or it will publish structured data
one bake behind. It is safe to run repeatedly; it is idempotent.

RAILS
  - a page with no visible FAQ is left alone; the JSON-LD is never blanked
  - a question or answer that comes out empty aborts that page
  - an answer still carrying template syntax ('+esc( , {{ , ${) aborts
  - answers under MIN_ANSWER characters abort -- a one-word answer in the
    structured data is worse than none
  - --check exits non-zero on drift without writing, for CI
"""
import argparse
import html as H
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

MIN_ANSWER = 25
TEMPLATE_TELLS = ("'+", "+'", "{{", "${", "</script>")

FAQ_OPEN = re.compile(r'<(\w+)[^>]*(?:class|id)="[^"]*faq[^"]*"[^>]*>', re.I)
DETAILS = re.compile(r"<details[^>]*>\s*<summary[^>]*>(.*?)</summary>(.*?)</details>", re.S)
LD_BLOCK = re.compile(r'<script type="application/ld\+json">\s*(\{.*?\})\s*</script>', re.S)


def text_of(fragment):
    """Visible text of an HTML fragment, entities resolved, spacing normalised."""
    f = re.sub(r"<(script|style).*?</\1>", " ", fragment, flags=re.S)
    f = re.sub(r"<br\s*/?>", " ", f)
    f = re.sub(r"</(p|div|li|h[1-6])>", " ", f)
    f = re.sub(r"<[^>]+>", "", f)
    return re.sub(r"\s+", " ", H.unescape(f)).strip()


def container_span(body, start, tag):
    """End offset of the element opened at `start`, by depth counting.

    A backreference regex cannot do this. <div class="faq"> wraps
    <div class="ans"> on several of these pages, so `(.*?)</div>` stops at the
    INNER close and the FAQ looks empty -- which is exactly what the first
    version of this script reported.
    """
    depth = 0
    pat = re.compile(rf"<(/?){tag}\b[^>]*?(/?)>", re.I)
    for m in pat.finditer(body, start):
        closing, selfclose = m.group(1), m.group(2)
        if selfclose:
            continue
        depth += -1 if closing else 1
        if depth == 0:
            return m.end()
    return len(body)


def visible_faq(html):
    """[(question, answer)] from the page's own FAQ container, in page order.

    Scoped to the container on purpose. A <summary> elsewhere on the page is a
    disclosure widget -- /harvest-price-tracker's "Year by year, 2011-2026" is
    a collapsible table, not a question anybody asked.
    """
    body = re.sub(r"<script.*?</script>", " ", html, flags=re.S)
    out, seen = [], set()
    for m in FAQ_OPEN.finditer(body):
        end = container_span(body, m.start(), m.group(1))
        for dm in DETAILS.finditer(body, m.end(), end):
            if dm.start() in seen:          # nested faq-ish containers
                continue
            seen.add(dm.start())
            out.append((text_of(dm.group(1)), text_of(dm.group(2))))
    return out


def problems(pairs):
    bad = []
    for i, (q, a) in enumerate(pairs, 1):
        if not q:
            bad.append(f"item {i}: empty question")
        if not a:
            bad.append(f"item {i}: empty answer for {q[:40]!r}")
        elif len(a) < MIN_ANSWER:
            bad.append(f"item {i}: answer only {len(a)} chars for {q[:40]!r}")
        for tell in TEMPLATE_TELLS:
            if tell in q or tell in a:
                bad.append(f"item {i}: template syntax {tell!r} in {q[:40]!r}")
                break
    return bad


def faq_json(pairs):
    return {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": q,
                            "acceptedAnswer": {"@type": "Answer", "text": a}}
                           for q, a in pairs]}


def current_faq(html):
    for m in LD_BLOCK.finditer(html):
        try:
            d = json.loads(m.group(1))
        except Exception:                                     # noqa: BLE001
            continue
        if isinstance(d, dict) and d.get("@type") == "FAQPage":
            return m, d
    return None, None


def rebuild(html):
    """(new_html, note). new_html is None when nothing should change."""
    pairs = visible_faq(html)
    if not pairs:
        return None, "no visible FAQ — left alone"
    bad = problems(pairs)
    if bad:
        return None, "refused: " + "; ".join(bad[:3])
    m, existing = current_faq(html)
    want = faq_json(pairs)
    if m is None:
        return None, f"{len(pairs)} visible questions but no FAQPage block to update"
    if existing == want:
        return None, f"already in sync ({len(pairs)} questions)"
    have_q = [q.get("name", "") for q in existing.get("mainEntity", [])]
    want_q = [q["name"] for q in want["mainEntity"]]
    added = [q for q in want_q if q not in have_q]
    gone = [q for q in have_q if q not in want_q]
    note = f"{len(have_q)} → {len(want_q)} questions"
    if gone:
        note += f" · dropped {gone[0][:44]!r}" + (f" +{len(gone)-1} more" if len(gone) > 1 else "")
    if added:
        note += f" · added {added[0][:44]!r}" + (f" +{len(added)-1} more" if len(added) > 1 else "")
    new = html[:m.start(1)] + json.dumps(want, ensure_ascii=False) + html[m.end(1):]
    return new, note


def run(pages, write=True, check=False):
    changed, drifted = [], []
    for page in pages:
        p = REPO / page
        if not p.exists():
            print(f"  {page}: missing"); continue
        src = p.read_text(encoding="utf-8")
        new, note = rebuild(src)
        flag = " " if new is None else "*"
        print(f" {flag} {page:<30} {note}")
        if new is None:
            continue
        drifted.append(page)
        if write and not check:
            p.write_text(new, encoding="utf-8")
            changed.append(page)
    print("-" * 68)
    if check:
        print(f"drifted: {len(drifted)}" + (f" — {', '.join(drifted)}" if drifted else ""))
        return 1 if drifted else 0
    print(f"rewrote {len(changed)}: {', '.join(changed) or 'none'}")
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  — {detail}" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    def page(faq_html, ld_questions):
        ld = json.dumps({"@context": "https://schema.org", "@type": "FAQPage",
                         "mainEntity": [{"@type": "Question", "name": q,
                                         "acceptedAnswer": {"@type": "Answer", "text": "old"}}
                                        for q in ld_questions]})
        return (f'<script type="application/ld+json">{ld}</script>'
                f'<div class="faq">{faq_html}</div>')

    good = ("<details><summary>Is my elevator ripping me off?</summary>"
            "<div class='ans'>No &mdash; basis is set by the market, and here is how to "
            "tell the difference.</div></details>")

    print("the page becomes the source of truth")
    new, note = rebuild(page(good, ["Is basis set by my local elevator?"]))
    ck("drifted structured data is rewritten from the page", new is not None, note)
    d = json.loads(LD_BLOCK.search(new).group(1))
    ck("the question is the visible one",
       d["mainEntity"][0]["name"] == "Is my elevator ripping me off?",
       d["mainEntity"][0]["name"])
    ck("entities are resolved, not escaped",
       "&mdash;" not in d["mainEntity"][0]["acceptedAnswer"]["text"] and
       "—" in d["mainEntity"][0]["acceptedAnswer"]["text"])
    ck("running it twice changes nothing", rebuild(new)[0] is None)

    print("\nrails")
    ck("a page with no visible FAQ is left alone",
       rebuild('<script type="application/ld+json">{"@type":"FAQPage",'
               '"mainEntity":[]}</script>')[0] is None)
    ck("a <summary> outside the FAQ container is ignored",
       rebuild(f'<div>{good}</div>')[0] is None)
    short = "<details><summary>Q?</summary><div>No.</div></details>"
    n, note = rebuild(page(short, ["Q?"]))
    ck("a too-short answer aborts the page", n is None and "refused" in note, note)
    tmpl = ("<details><summary>Other crops in '+esc(name)+'</summary>"
            "<div>Some reasonably long answer text goes right here.</div></details>")
    n, note = rebuild(page(tmpl, ["x"]))
    ck("template syntax aborts the page", n is None and "refused" in note, note)
    empty = "<details><summary></summary><div>A long enough answer sits here.</div></details>"
    n, note = rebuild(page(empty, ["x"]))
    ck("an empty question aborts the page", n is None and "refused" in note, note)
    ck("visible FAQ but no FAQPage block does not invent one",
       rebuild(f'<div class="faq">{good}</div>')[0] is None)

    print("\nother JSON-LD on the page is untouched")
    other = ('<script type="application/ld+json">{"@type":"Dataset","name":"keep me"}</script>'
             + page(good, ["Is basis set by my local elevator?"]))
    new, _ = rebuild(other)
    ck("a Dataset block survives", '"name":"keep me"' in new or '"name": "keep me"' in new)

    print()
    if fails:
        print(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1
    print("all bake_faq checks pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--page", default=None)
    ap.add_argument("--check", action="store_true", help="report drift, write nothing")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    pages = [a.page] if a.page else sorted(
        p.name for p in REPO.glob("*.html") if p.name not in {"404.html", "index1.html"})
    return run(pages, check=a.check)


if __name__ == "__main__":
    sys.exit(main())
