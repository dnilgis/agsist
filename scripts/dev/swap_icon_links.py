#!/usr/bin/env python3
"""swap_icon_links.py: point every page's icon links at the SVG favicon.

PREPARED, NOT RUN (Oct 21, 2026). The new icon files keep the old names
(scripts/dev/make-brand-icons.mjs), so the swap of the picture itself needs no
page edits. This script is the second, optional step: it adds the SVG icon
(sharp at every size, lighter tile on dark tab strips) to the head of every
page and to every generator that writes a head, so a rebuild keeps it.

The link block it leaves (the pattern Chrome, Edge and Firefox pick the SVG
from; Safari keeps the ICO and the apple-touch-icon):
    <link rel="icon" href="/img/favicon.ico" sizes="32x32">
    <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
    <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">   (unchanged where present)
    <link rel="manifest" href="/manifest.json">                      (unchanged where present)
The old <link rel="icon" type="image/png" ... favicon-16/32.png> lines go:
next to an SVG, Chrome can pick a 32 px PNG over it. A file whose only icon
link is the 32 px PNG gets the two lines in its place.

Left alone: rain-print.html (its PNG icons are inline on purpose, see
test/rain-print-buy-path.test.mjs), pages with no icon link (meta-refresh
stubs, print sheets: /favicon.ico at the root covers them), test/ fixtures.

  python3 scripts/dev/swap_icon_links.py --selftest
  python3 scripts/dev/swap_icon_links.py --dry-run     # counts, writes nothing
  python3 scripts/dev/swap_icon_links.py               # write pages + generators
  python3 scripts/dev/swap_icon_links.py --check       # exit 1 if any page or generator still lacks the SVG link
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKIP = {"rain-print.html"}
SKIP_DIRS = ("test/", "node_modules/", ".github/")
ICO_NEW = '<link rel="icon" href="/img/favicon.ico" sizes="32x32">'
SVG_NEW = '<link rel="icon" type="image/svg+xml" href="/img/icon.svg">'

# q is "" in HTML, \" inside a Python/JS string literal
Q = r'(?P<q>\\?)"'
ICO = re.compile(r'<link\s+rel=' + Q + r'(?:shortcut )?icon(?P=q)"\s+type=(?P=q)"image/x-icon(?P=q)"\s+href=(?P=q)"/img/favicon\.ico(?P=q)"\s*/?>')
PNG = re.compile(r'<link\s+rel=' + Q + r'icon(?P=q)"\s+type=(?P=q)"image/png(?P=q)"\s+sizes=(?P=q)"(?:16x16|32x32)(?P=q)"\s+href=(?P=q)"/img/favicon-(?:16|32)\.png(?P=q)"\s*/?>')


# a source line holding only a tag in a string literal: '        "<link ...>\\n"' (maybe a trailing + or ,)
LITERAL = re.compile(r'([ \t]*)"<link[^\n]*?>\\n"(\s*[+,]?\s*)')


def esc(tag, q):
    return tag.replace('"', q + '"') if q else tag


def swap(text):
    """New text and the number of icon blocks changed. Idempotent."""
    if "/img/icon.svg" in text:
        return text, 0
    lines = text.split("\n")
    out, n, done_png_only = [], 0, False
    has_ico = bool(ICO.search(text))
    for ln in lines:
        m = ICO.search(ln)
        if m:
            q = m.group("q")
            lit = LITERAL.fullmatch(ln) if q else None
            if lit:  # a line that is one string literal ending in \n: two such lines, so the pages get two lines
                ln = (lit.group(1) + '"' + esc(ICO_NEW, q) + '\\n"\n' + lit.group(1) + '"' + esc(SVG_NEW, q) + '\\n"' + lit.group(2))
            elif q:  # a tag inside some other string literal: both tags on the one line
                ln = ln[:m.start()] + esc(ICO_NEW, q) + esc(SVG_NEW, q) + ln[m.end():]
            else:
                indent = re.match(r"[ \t]*", ln).group(0)
                ln = ln[:m.start()] + ICO_NEW + "\n" + indent + SVG_NEW + ln[m.end():]
            n += 1
            out.append(ln)
            continue
        m = PNG.search(ln)
        if m:
            q = m.group("q")
            if not has_ico and not done_png_only:
                ln = ln[:m.start()] + esc(ICO_NEW, q) + ("" if q else "\n" + re.match(r"[ \t]*", ln).group(0)) + esc(SVG_NEW, q) + ln[m.end():]
                done_png_only = True
                n += 1
                out.append(ln)
                continue
            rest = (ln[:m.start()] + ln[m.end():])
            # the whole line was this tag (plain, or a quoted '"<link ...>\n"' literal): drop it
            if re.fullmatch(r'\s*', rest) or re.fullmatch(r'\s*"(\\n)?"\s*', rest) or re.fullmatch(r"\s*'(\\n)?'\s*", rest):
                continue
            ln = rest
        out.append(ln)
    return "\n".join(out), n


def targets():
    files = subprocess.run(["git", "ls-files", "*.html", "scripts/*.py", "scripts/*.mjs", "components/*.html"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    for f in files:
        if f in SKIP or f.startswith(SKIP_DIRS) or f == "scripts/dev/swap_icon_links.py":
            continue
        yield f


def run(write, check):
    pages = gens = left = 0
    stale = []
    for f in targets():
        p = os.path.join(ROOT, f)
        with open(p, encoding="utf-8") as fh:
            t = fh.read()
        if "favicon" not in t:
            continue
        new, n = swap(t)
        if n:
            if f.endswith(".html"):
                pages += 1
            else:
                gens += 1
            stale.append(f)
            if write:
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(new)
        elif "/img/icon.svg" not in t and (ICO.search(t) or PNG.search(t)):
            left += 1
    verb = "changed" if write else "would change"
    print(f"[icons] {verb} {pages} pages and {gens} generators" + (f"; {left} files with icon links it cannot read" if left else ""))
    if check and stale:
        for f in stale[:20]:
            print("  no svg icon:", f)
        return 1
    return 0


def selftest():
    a = ('  <link rel="icon" type="image/x-icon"            href="/img/favicon.ico">\n'
         '  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">\n'
         '  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">\n'
         '  <link rel="apple-touch-icon"                    href="/img/apple-touch-icon.png">\n')
    o, n = swap(a)
    assert n == 1, n
    assert o == ('  ' + ICO_NEW + '\n  ' + SVG_NEW + '\n'
                 '  <link rel="apple-touch-icon"                    href="/img/apple-touch-icon.png">\n'), o
    assert swap(o) == (o, 0), "idempotent"
    py = ('        "<link rel=\\"icon\\" type=\\"image/x-icon\\" href=\\"/img/favicon.ico\\">\\n"\n'
          '        "<link rel=\\"icon\\" type=\\"image/png\\" sizes=\\"32x32\\" href=\\"/img/favicon-32.png\\">\\n"\n'
          '        "<link rel=\\"apple-touch-icon\\" href=\\"/img/apple-touch-icon.png\\">\\n"\n')
    o, n = swap(py)
    assert n == 1 and "favicon-32" not in o and o.count("\n") == 3, o
    assert o.split("\n")[1] == '        "<link rel=\\"icon\\" type=\\"image/svg+xml\\" href=\\"/img/icon.svg\\">\\n"', o
    one = 'h = "<head><link rel=\\"icon\\" type=\\"image/x-icon\\" href=\\"/img/favicon.ico\\"><title>"'
    o, n = swap(one)
    assert n == 1 and o.count("\n") == 0 and "icon.svg" in o, o
    only = '<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">\n<style>'
    o, n = swap(only)
    assert n == 1 and o == ICO_NEW + "\n" + SVG_NEW + "\n<style>", o
    inline = '<link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,AAAA">'
    assert swap(inline) == (inline, 0), "an inline icon is not a link to swap"
    print("[icons] selftest ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        selftest()
        sys.exit(0)
    sys.exit(run(write=not ({"--dry-run", "--check"} & set(a)), check="--check" in a))
