#!/usr/bin/env python3
"""The clean restyle of index1.html, reproducible from origin.

1. build/consolidate_home_css.py: every inline <style> block -> css/home.css,
   in document order (pixel-identical; verified).
2. Append build/home_look.css (the three looks) to css/home.css, once.
3. <html data-look="..."> picks the look (default bands: Sig chose it 2026-10-03).
4. Shared bids script: "basis vs Nov '26 soybeans" -> "basis vs Nov '26" on a
   line that already says Soybeans. Wheat keeps its exchange ("KC wheat").

    python3 build/restyle_home.py [panels|bands|families]
"""
import pathlib, re, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
look = sys.argv[1] if len(sys.argv) > 1 else "bands"
assert look in ("panels", "bands", "families")
page = ROOT / "index1.html"
if "<style" in page.read_text(encoding="utf-8"):
    subprocess.run([sys.executable, str(ROOT / "build/consolidate_home_css.py")], check=True)
css_p = ROOT / "css/home.css"
css = css_p.read_text(encoding="utf-8")
MARK = "/* ===== THE LOOK (2026-10-03)"
if MARK in css:
    css = css[:css.index(MARK)].rstrip() + "\n"
css += "\n" + (ROOT / "build/home_look.css").read_text(encoding="utf-8")
css_p.write_text(css, encoding="utf-8")
s = page.read_text(encoding="utf-8")
s = re.sub(r'<html lang="en" data-theme="dark"( data-look="[a-z]+")?>', f'<html lang="en" data-theme="dark" data-look="{look}">', s, count=1)
page.write_text(s, encoding="utf-8")
js_p = ROOT / "components/bids-homepage.js"
js = js_p.read_text(encoding="utf-8")
for old, new in [("if(rm) refTxt = 'basis vs ' + rm;", "if(rm) refTxt = 'basis vs ' + rm.replace(/ (corn|soybeans)$/, '');"),
                 ("el.textContent = 'basis vs ' + cand.label;", "el.textContent = 'basis vs ' + cand.label.replace(/ (corn|soybeans)$/, '');")]:
    if old in js:
        assert js.count(old) == 1, old
        js = js.replace(old, new)
    elif new not in js:
        sys.exit("bids-homepage.js: anchor not found: " + old)
js_p.write_text(js, encoding="utf-8")
print(f"restyled: look={look}, css/home.css {len(css)} bytes")
