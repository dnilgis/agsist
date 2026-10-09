#!/usr/bin/env python3
"""Link the first ARC/PLC mention in a daily briefing page to /arc-plc.

generate_daily.generate_archive_html() runs every /daily/YYYY-MM-DD page
through link_first() so a briefing that talks about ARC or PLC points readers
(and crawlers) at the calculator. Only text inside <article> is touched, never
a tag, an attribute, an existing link, a heading, a button or a script, and
only the first mention gets the link. A page with no mention, or one that
already links /arc-plc inside its article, comes back unchanged. Idempotent.

    python3 scripts/arc_plc_link.py daily/*.html   # link existing pages in place
"""
import re
import sys

HREF = "/arc-plc"
# Gold and underlined like the page's other links; the padding/negative margin
# (the byline link's trick) gives a 40px+ tap height without moving the text.
STYLE = ("color:var(--gold);text-decoration:underline;text-underline-offset:2px;"
         "display:inline-block;padding:.7rem 0;margin:-.7rem 0")
# Longest phrase first so "ARC/PLC" becomes one link, not "ARC" alone.
MENTION_RE = re.compile(r"\b(?:ARC(?:/PLC|-CO| and PLC| or PLC| vs\.? PLC)?|PLC)\b")
TOKEN_RE = re.compile(r"<!--.*?-->|<[^>]*>", re.S)
SKIP = {"a", "h1", "h2", "h3", "button", "script", "style", "title", "summary", "select", "textarea"}
TAG_RE = re.compile(r"<\s*(/?)\s*([a-zA-Z0-9]+)")


def _link_region(html):
    out, pos, skip = [], 0, []
    for t in TOKEN_RE.finditer(html):
        text = html[pos:t.start()]
        if not skip:
            m = MENTION_RE.search(text)
            if m:
                out.append(text[:m.start()])
                out.append(f'<a href="{HREF}" style="{STYLE}">{m.group(0)}</a>')
                out.append(text[m.end():])
                out.append(html[t.start():])
                return "".join(out), True
        out.append(text)
        tag = t.group(0)
        tm = TAG_RE.match(tag)
        if tm and not tag.endswith("/>"):
            closing, name = tm.group(1) == "/", tm.group(2).lower()
            if name in SKIP:
                if closing:
                    if name in skip:
                        while skip and skip.pop() != name:
                            pass
                else:
                    skip.append(name)
        out.append(tag)
        pos = t.end()
    tail = html[pos:]
    if not skip:
        m = MENTION_RE.search(tail)
        if m:
            return html[:pos] + tail[:m.start()] + f'<a href="{HREF}" style="{STYLE}">{m.group(0)}</a>' + tail[m.end():], True
    return html, False


def link_first(page):
    """Return page with the first ARC/PLC mention in its <article> linked."""
    a = page.find("<article")
    b = page.find("</article>", a)
    if a < 0 or b < 0:
        return page
    region = page[a:b]
    if f'href="{HREF}"' in region:
        return page
    new, _ = _link_region(region)
    return page[:a] + new + page[b:]


def main(paths):
    changed = 0
    for p in paths:
        with open(p, encoding="utf-8") as f:
            s = f.read()
        n = link_first(s)
        if n != s:
            with open(p, "w", encoding="utf-8") as f:
                f.write(n)
            changed += 1
            print(f"linked: {p}")
    print(f"{changed} of {len(paths)} pages linked")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
