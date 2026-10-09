#!/usr/bin/env python3
"""
A BRIEFING THAT TALKS ABOUT ARC OR PLC LINKS THE CALCULATOR, ONCE.

scripts/arc_plc_link.py links the first ARC/PLC mention inside a daily page's
<article> to /arc-plc, and generate_daily.generate_archive_html() runs every
page through it. This proves: the first mention in text gets the link, the
second does not, tags/attributes/headings/existing links are never touched,
a page that already links /arc-plc is left alone, it is idempotent, and the
generator's real page builder applies it.

    python3 scripts/test_arc_plc_link.py

No network. Under a second.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import arc_plc_link as L  # noqa: E402

FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + detail))
    if not ok:
        FAILED.append(name)


def page(body, head='<title>ARC/PLC day</title><meta name="description" content="ARC/PLC">'):
    return f"<html><head>{head}</head><body><nav>PLC</nav><article>{body}</article><footer>ARC</footer></body></html>"


A = f'<a href="/arc-plc" style="{L.STYLE}">'

p = L.link_first(page('<h1>ARC/PLC signup</h1><p>Watch ARC/PLC enrollment and PLC rates.</p>'))
check(p.count(A) == 1, "exactly one link")
check(f"Watch {A}ARC/PLC</a> enrollment" in p, "first body mention linked as one phrase", p)
check("<h1>ARC/PLC signup</h1>" in p, "headline left alone")
check("<title>ARC/PLC day</title>" in p and 'content="ARC/PLC"' in p, "head untouched")
check("<nav>PLC</nav>" in p and "<footer>ARC</footer>" in p, "outside <article> untouched")
check(L.link_first(p) == p, "idempotent")

p = L.link_first(page('<p class="ARC">See <a href="/x">ARC rules</a>, then ARC and PLC.</p>'))
check('class="ARC"' in p, "attributes untouched")
check('<a href="/x">ARC rules</a>' in p, "text inside an existing link untouched")
check(f"then {A}ARC and PLC</a>." in p, "next mention outside the link gets it", p)

src = page('<p>Pick <a href="/arc-plc">the tool</a>. ARC pays on county revenue.</p>')
check(L.link_first(src) == src, "page already linking /arc-plc unchanged")

for word in ("ARCHIVE", "MARCH", "PLCs", "arc welder"):
    src = page(f"<p>{word} notes</p>")
    check(L.link_first(src) == src, f"no false match on {word!r}")

src = page("<p>No program talk today.</p>")
check(L.link_first(src) == src, "no mention, no change")

check(L.link_first("<p>ARC</p>") == "<p>ARC</p>", "no <article>, no change")

p = L.link_first(page("<p>The PLC rate</p><script>var s='ARC';</script>"))
check(f"The {A}PLC</a> rate" in p and "var s='ARC'" in p, "script left alone")

# The generator's real page builder applies it.
import generate_daily as G  # noqa: E402
brief = {"date": "Friday, October 9, 2026", "headline": "Beans firm",
         "lead": "Corn steady.", "sections": [{"title": "Policy", "body": "USDA opened ARC/PLC signup. PLC matters too."}],
         "generator_version": "5.5"}
html = G.generate_archive_html(brief, "2026-10-09")
art = html[html.find("<article"):html.find("</article>")]
check(art.count(A) == 1 and f"{A}ARC/PLC</a> signup" in art, "generate_archive_html links the first mention", art[:400])

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall arc-plc link checks pass")
