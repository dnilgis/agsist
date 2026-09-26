#!/usr/bin/env python3
"""
AGSIST -- make every FAQPage JSON-LD answer visible on the page, from the same strings.

WHY THIS EXISTS
The 2026-09-26 SEO audit found FAQPage markup on 11 pages with no matching
visible FAQ (0 of the schema questions in the rendered text), and 6 more where
the visible wording and the markup drift apart. Marking up questions the page
does not show is the mismatch Google's FAQ guidance forbids and answer engines
treat as untrustworthy.

Two modes, chosen per page in PAGES below:

  render  The page has NO visible FAQ. The FAQPage JSON-LD is the source; this
          script writes a static, no-JS <details> section built from the very
          same strings, between <!--FAQ:START--> and <!--FAQ:END--> markers.
          Re-running replaces that span, so it is idempotent.

  sync    The page ALREADY shows a FAQ (visible is the reference). The JSON-LD
          FAQPage is rewritten to equal the visible questions and answers.
          Nothing is added to the page body.

The rendered block uses class "faq agf" on its container and <details><summary>
inside, which is the shape scripts/bake_faq.py reads, so bake_faq derives the
same JSON-LD back from it and reports "already in sync".

USAGE
  python3 scripts/render_faq_html.py            # write
  python3 scripts/render_faq_html.py --check    # exit 1 if any schema Q/A is not
                                                # verbatim in the page's visible text
  python3 scripts/render_faq_html.py --all --check   # every root page with FAQPage
  python3 scripts/render_faq_html.py --root DIR      # operate on a copy of the tree

Run order: after build_condyield.py / build_croptour.py, before bake_faq.py
(bake_faq is a no-op on these pages once they agree).
"""
import argparse
import html as H
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from bake_faq import text_of, problems, DETAILS  # noqa: E402

REPO = Path(__file__).resolve().parent.parent

START, END = "<!--FAQ:START-->", "<!--FAQ:END-->"
SPAN = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
LD = re.compile(r'(<script type="application/ld\+json">)(\s*.*?\s*)(</script>)', re.S)

# page -> (mode, where)
#   render: where = literal string to insert before (its line start), or
#           "wrapper_end" (before the last </div> ahead of </main>), or "main_end".
#   sync:   where = how the visible FAQ is marked up: items | dl | details | ao
PAGES = {
    "gdu-calculator":       ("render", '<div class="gdu-source">'),
    "planting-date":        ("render", '<div class="pd-source">'),
    "usda-calendar":        ("render", '<div class="cal-foot">'),
    "usda-quick-stats":     ("render", "wrapper_end"),
    "fertilizer":           ("render", '<div class="fert-source">'),
    "fast-facts":           ("render", "main_end"),
    "drought-monitor":      ("render", "main_end"),
    "crop-tour":            ("render", '<div class="ct-chips">'),
    "yield-estimator":      ("render", '<div class="ye-disclaimer">'),
    "tariffs":              ("render", '<div class="tariff-source">'),
    "grain-bin-calculator": ("sync", "dl"),
    "corn-futures-prices":  ("sync", "items"),
    "soybean-futures-prices": ("sync", "items"),
    "wheat-futures-prices": ("sync", "items"),
    "storage-crunch":       ("sync", "details"),
    "ag-odds":              ("sync", "ao"),
}

STYLE = """<style>
.agf{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:1.1rem 1.2rem;margin:1.5rem 0 0}
.agf-t{font-family:var(--font-display);font-size:.95rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text);margin:0 0 .4rem}
.agf details{border-top:1px solid var(--border)}
.agf details:first-of-type{border-top:0}
.agf summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:baseline;gap:.75rem;padding:.85rem 0;font-size:1rem;font-weight:600;line-height:1.4;color:var(--text)}
.agf summary::-webkit-details-marker{display:none}
.agf summary::after{content:"+";color:var(--gold);font-weight:700;flex-shrink:0}
.agf details[open] summary::after{content:"\\2212"}
.agf summary:focus-visible{outline:2px solid var(--gold);outline-offset:2px;border-radius:4px}
.agf-a{font-size:1rem;line-height:1.65;color:var(--text-dim);padding:0 0 .95rem}
</style>"""


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def faq_nodes(obj):
    return [n for n in walk(obj) if n.get("@type") == "FAQPage"]


def schema_pairs(src):
    out = []
    for m in LD.finditer(src):
        try:
            d = json.loads(m.group(2))
        except ValueError:
            continue
        for n in faq_nodes(d):
            for q in n.get("mainEntity", []):
                out.append((norm(q["name"]), norm(q["acceptedAnswer"]["text"])))
    return out


def visible_text(src):
    s = re.sub(r"<!--.*?-->", " ", src, flags=re.S)
    s = re.sub(r"<(script|style)\b.*?</\1>", " ", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", " ", s)
    # block boundaries become spaces, inline tags vanish (same rule as bake_faq.text_of),
    # so "<b>x</b>," reads "x," and not "x ,"
    s = re.sub(r"</?(p|div|li|ul|ol|h[1-6]|tr|td|th|summary|details|dt|dd|section|article|table)\b[^>]*>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    return norm(H.unescape(s))


def render_block(pairs):
    rows = "\n".join(
        f"<details><summary>{H.escape(H.unescape(q), quote=False)}</summary>"
        f'<div class="agf-a">{H.escape(H.unescape(a), quote=False)}</div></details>'
        for q, a in pairs)
    return (f"{START}\n{STYLE}\n"
            f'<section class="faq agf" aria-labelledby="agf-t">\n'
            f'<h2 class="agf-t" id="agf-t">Common questions</h2>\n{rows}\n</section>\n{END}')


def line_start(src, idx):
    return src.rfind("\n", 0, idx) + 1


def insert_block(src, block, where):
    if SPAN.search(src):
        return SPAN.sub(lambda m: block, src, count=1)
    if where == "main_end":
        idx = line_start(src, src.rfind("</main>"))
    elif where == "wrapper_end":
        idx = line_start(src, src.rfind("</div>", 0, src.rfind("</main>")))
    else:
        i = src.find(where)
        if i < 0:
            raise ValueError(f"anchor not found: {where}")
        idx = line_start(src, i)
    return src[:idx] + block + "\n\n" + src[idx:]


# ---- sync mode: visible FAQ is the reference -------------------------------

ITEM = re.compile(r'<div class="faq-item[^"]*">\s*<div class="faq-q"[^>]*>(.*?)</div>\s*'
                  r'<div class="faq-a"><div class="faq-a-inner">(.*?)</div></div>', re.S)
AOI = re.compile(r'<div class="ao-faq-item">\s*<h3 class="ao-faq-h"><button[^>]*>(.*?)</button></h3>\s*'
                 r'<div class="ao-faq-a"><div class="ao-faq-ai">(.*?)</div></div>', re.S)
DLI = re.compile(r'<div class="faq-item">\s*<dt>(.*?)</dt>\s*<dd>(.*?)</dd>', re.S)


def visible_pairs(src, kind):
    body = re.sub(r"<script.*?</script>", " ", src, flags=re.S)
    if kind == "items":
        return [(text_of(q), text_of(a)) for q, a in ITEM.findall(body)]
    if kind == "ao":
        return [(text_of(q), text_of(a)) for q, a in AOI.findall(body)]
    if kind == "dl":
        return [(text_of(q), text_of(a)) for q, a in DLI.findall(body)]
    i = body.find("Questions people actually ask")
    return [(text_of(q), text_of(a)) for q, a in DETAILS.findall(body, i if i >= 0 else 0)]


def _array_span(text, key_at):
    """(start, end) of the JSON array that follows "mainEntity" at/after key_at."""
    m = re.compile(r'"mainEntity"\s*:\s*\[').search(text, key_at)
    if not m:
        return None
    i, depth, instr, esc = m.end() - 1, 0, False, False
    for j in range(i, len(text)):
        c = text[j]
        if instr:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                instr = False
        elif c == '"':
            instr = True
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return i, j + 1
    return None


def set_schema(src, pairs):
    """Replace only the FAQPage mainEntity array text; every other byte stays put."""
    want = json.dumps([{"@type": "Question", "name": q,
                        "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in pairs],
                      ensure_ascii=False)

    def one(m):
        body = m.group(2)
        k = re.search(r'"@type"\s*:\s*"FAQPage"', body)
        if not k:
            return m.group(0)
        span = _array_span(body, k.start())
        if not span:
            return m.group(0)
        body = body[:span[0]] + want + body[span[1]:]
        json.loads(body)                       # never write a block that does not parse
        return m.group(1) + body + m.group(3)

    return LD.sub(one, src)


# ---- driver -----------------------------------------------------------------

def process(root, page, mode, where):
    p = root / f"{page}.html"
    src = p.read_text(encoding="utf-8")
    if mode == "render":
        block_src = SPAN.sub("", src)          # schema is the source, ignore old block
        pairs = schema_pairs(block_src)
        if not pairs:
            return None, "no FAQPage JSON-LD to render"
        bad = problems(pairs)
        if bad:
            return None, "refused: " + "; ".join(bad[:3])
        new = insert_block(src, render_block(pairs), where)
        return new, f"render {len(pairs)} Q"
    pairs = visible_pairs(src, where)
    if not pairs:
        return None, "sync: visible FAQ not found, left alone"
    bad = problems(pairs)
    if bad:
        return None, "refused: " + "; ".join(bad[:3])
    new = set_schema(src, pairs)
    return new, f"sync schema to {len(pairs)} visible Q"


def check(root, pages):
    fails = 0
    for page in pages:
        src = (root / f"{page}.html").read_text(encoding="utf-8")
        vt = visible_text(src)
        pairs = schema_pairs(src)
        miss = [(q, a) for q, a in pairs if q not in vt or a not in vt]
        if not pairs:
            print(f"  {page:<26} no FAQPage")
            continue
        if miss:
            fails += 1
            print(f"  FAIL {page:<21} {len(miss)}/{len(pairs)} not verbatim on page: {miss[0][0][:50]!r}")
        else:
            print(f"  ok   {page:<21} {len(pairs)}/{len(pairs)} verbatim")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--all", action="store_true", help="with --check: every root page with a FAQPage")
    ap.add_argument("--root", default=str(REPO))
    a = ap.parse_args()
    root = Path(a.root)
    pages = list(PAGES)
    if a.check:
        if a.all:
            pages = sorted(p.stem for p in root.glob("*.html")
                           if '"FAQPage"' in p.read_text(encoding="utf-8", errors="ignore"))
        return check(root, pages)
    changed = 0
    for page in pages:
        mode, where = PAGES[page]
        try:
            new, note = process(root, page, mode, where)
        except ValueError as e:
            print(f"  {page:<26} ERROR {e}")
            return 1
        p = root / f"{page}.html"
        if new is None:
            print(f"  {page:<26} {note}")
        elif new == p.read_text(encoding="utf-8"):
            print(f"  {page:<26} unchanged ({note})")
        else:
            p.write_text(new, encoding="utf-8")
            changed += 1
            print(f"* {page:<26} {note}")
    print(f"changed {changed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
