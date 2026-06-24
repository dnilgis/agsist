#!/usr/bin/env python3
"""
build_farmbill.py  —  AGSIST farm-bill page baker.

Reads farm-bill.json and bakes the dynamic regions (status pills, TL;DR cells,
House-vs-Senate rows, status tracker, the "updated" stamp, and the two head
modified-dates) directly into farm-bill.html, in place, between stable marker
comments. The values land in STATIC HTML — no client-side fetch — so JS-blind
AI crawlers see them. That's the whole point: this is the citation surface.

Update flow:
    1. edit farm-bill.json
    2. run:  python3 build_farmbill.py
       (or just push — the GitHub Action runs this for you)

Idempotent: running it twice with the same JSON produces a byte-identical file.
Self-validating: refuses to write if the result fails the structure gauntlet.

Usage:
    python3 build_farmbill.py                 # bake in place
    python3 build_farmbill.py --check         # verify only, write nothing (CI)
    python3 build_farmbill.py --html PATH --json PATH
"""

import argparse
import json
import re
import sys
from html.parser import HTMLParser

# ── region renderers — each reproduces the page's existing markup exactly ──

def render_pills(data):
    out = []
    for p in data["pills"]:
        out.append(
            f'      <span class="pill {p["cls"]}"><span class="mk"></span>{p["html"]}</span>'
        )
    return "\n".join(out)


def render_tldr(data):
    out = []
    for c in data["tldr"]:
        out.append(
            f'        <div class="tldr-cell"><div class="k">{c["k"]}</div>'
            f'<div class="vv">{c["v"]}</div></div>'
        )
    return "\n".join(out)


def render_compare(data):
    out = []
    for r in data["compare"]:
        out.append(
            f'      <div class="cmp-row"><div class="rk">{r["k"]}</div>'
            f'<div class="cv h">{r["h"]}</div>'
            f'<div class="cv s">{r["s"]}</div></div>'
        )
    return "\n".join(out)


def render_tracker(data):
    out = []
    for s in data["tracker"]:
        out.append(
            f'      <div class="step"><div class="stage">{s["stage"]}</div>'
            f'<div class="desc">{s["desc"]}</div>'
            f'<div class="mk {s["mk"]}">{s["label"]}</div></div>'
        )
    return "\n".join(out)


# region name -> (renderer, indent of the closing marker)
BLOCK_REGIONS = {
    "pills":   (render_pills,   "      "),
    "tldr":    (render_tldr,    "      "),
    "compare": (render_compare, "      "),
    "tracker": (render_tracker, "      "),
}


def replace_block(html, name, inner, close_indent):
    """Replace content between <!--FB:name--> ... <!--/FB:name--> markers."""
    pat = re.compile(r"(<!--FB:%s-->)(.*?)(<!--/FB:%s-->)" % (name, name), re.S)
    n = len(pat.findall(html))
    if n != 1:
        raise SystemExit(f"ERROR: expected exactly 1 '{name}' marker pair, found {n}. "
                         f"Is farm-bill.html instrumented?")
    return pat.sub(lambda m: f"{m.group(1)}\n{inner}\n{close_indent}{m.group(3)}", html)


def replace_inline(html, name, text):
    """Replace content between inline <!--FB:name-->...<!--/FB:name--> markers."""
    pat = re.compile(r"(<!--FB:%s-->).*?(<!--/FB:%s-->)" % (name, name), re.S)
    n = len(pat.findall(html))
    if n != 1:
        raise SystemExit(f"ERROR: expected exactly 1 inline '{name}' marker, found {n}.")
    return pat.sub(lambda m: f"{m.group(1)}{text}{m.group(2)}", html)


def replace_anchored(html, pattern, repl, label):
    """Targeted single-match replace for fields that can't carry HTML comments
    (e.g. inside a JSON-LD <script> block)."""
    rx = re.compile(pattern)
    n = len(rx.findall(html))
    if n != 1:
        raise SystemExit(f"ERROR: expected exactly 1 '{label}' match, found {n}.")
    return rx.sub(repl, html)


# ── validation gauntlet (runs before any write) ──

def validate(html):
    problems = []

    class P(HTMLParser):
        def error(self, m):
            raise Exception(m)
    try:
        P(convert_charrefs=True).feed(html)
    except Exception as e:
        problems.append(f"HTMLParser: {e}")

    o, c = len(re.findall(r"<div\b", html)), len(re.findall(r"</div>", html))
    if o != c:
        problems.append(f"div balance: {o} open / {c} close")

    if len(re.findall(r"<h1[\s>]", html)) != 1:
        problems.append("h1 count != 1")

    # every marker that exists must still be a matched pair
    opens = set(re.findall(r"<!--FB:([\w-]+)-->", html))
    closes = set(re.findall(r"<!--/FB:([\w-]+)-->", html))
    if opens != closes:
        problems.append(f"orphan markers: open={opens} close={closes}")

    # emoji-as-UI guard (typographic glyphs allowed; pictographic not)
    emoji = re.findall(r"[\U0001F000-\U0001FAFF\U00002600-\U000026FF\U0001F300-\U0001FAFF]", html)
    if emoji:
        problems.append(f"emoji-as-UI found: {set(emoji)}")

    return problems


def bake(html, data):
    for name, (renderer, indent) in BLOCK_REGIONS.items():
        html = replace_block(html, name, renderer(data), indent)
    # the "Updated <date>" stamp in the TL;DR header
    html = replace_inline(html, "stamp", f'Updated {data["updated_display"]}')
    # head: <meta property="article:modified_time" content="YYYY-MM-DD">
    html = replace_anchored(
        html,
        r'(<meta property="article:modified_time" content=")[0-9-]+(">)',
        lambda m: m.group(1) + data["updated"] + m.group(2),
        "article:modified_time",
    )
    # head: JSON-LD "dateModified":"YYYY-MM-DD"
    html = replace_anchored(
        html,
        r'("dateModified":")[0-9-]+(")',
        lambda m: m.group(1) + data["updated"] + m.group(2),
        "dateModified",
    )
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", default="farm-bill.html")
    ap.add_argument("--json", default="farm-bill.json")
    ap.add_argument("--check", action="store_true",
                    help="verify the baked output matches the file on disk; write nothing")
    args = ap.parse_args()

    with open(args.json, encoding="utf-8") as f:
        data = json.load(f)
    with open(args.html, encoding="utf-8") as f:
        original = f.read()

    baked = bake(original, data)

    problems = validate(baked)
    if problems:
        print("VALIDATION FAILED — not writing:")
        for p in problems:
            print("  -", p)
        sys.exit(1)

    if args.check:
        if baked != original:
            print("OUT OF DATE: farm-bill.html does not match farm-bill.json. "
                  "Run build_farmbill.py and commit.")
            sys.exit(1)
        print("OK: farm-bill.html is in sync with farm-bill.json.")
        return

    if baked == original:
        print("No change: farm-bill.html already up to date.")
        return

    with open(args.html, "w", encoding="utf-8") as f:
        f.write(baked)
    print(f"Baked farm-bill.html from farm-bill.json (updated {data['updated']}).")


if __name__ == "__main__":
    main()
