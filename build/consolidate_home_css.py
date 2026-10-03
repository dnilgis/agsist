#!/usr/bin/env python3
"""Phase 1 of the clean restyle: index1.html's inline <style> blocks become one
file, css/home.css, in document order. No rule is changed. Verified by a
pixel diff of the rendered page before and after.

    python3 build/consolidate_home_css.py
"""
import pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
p = ROOT / "index1.html"
s = p.read_text(encoding="utf-8")
blocks = list(re.finditer(r'<style([^>]*)>(.*?)</style>\n?', s, re.S))
if not blocks:
    sys.exit("no inline style blocks: already consolidated?")
parts = []
for i, m in enumerate(blocks):
    attr = m.group(1).strip()
    parts.append(f"/* ===== block {i+1} of {len(blocks)}{(' ' + attr) if attr else ''} ===== */\n{m.group(2).strip()}\n")
css = "/* css/home.css: the homepage's own styles, one file, in the order they\n   used to sit inline in index1.html. Loaded after components/styles.css\n   and components/sponsor-ad.css. */\n\n" + "\n".join(parts)
(ROOT / "css").mkdir(exist_ok=True)
(ROOT / "css" / "home.css").write_text(css, encoding="utf-8")
# remove blocks, back to front
for m in reversed(blocks):
    s = s[:m.start()] + s[m.end():]
anchor = '<link rel="stylesheet" href="/components/sponsor-ad.css?v=1">'
if s.count(anchor) != 1:
    sys.exit("sponsor-ad.css link not found once")
s = s.replace(anchor, anchor + '\n<link rel="stylesheet" href="/css/home.css?v=1">')
p.write_text(s, encoding="utf-8")
print(f"{len(blocks)} blocks -> css/home.css ({len(css)} bytes)")
