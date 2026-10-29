#!/usr/bin/env python3
"""Make a generated page smaller with no change a reader or a search engine sees.

The county, town and state page builders call slim() on each page just before
they write it. It only does what is the same page to a browser and a crawler:

  * JSON in <script type="application/ld+json"> and type="application/json"
    is written without the spaces and line breaks json.dumps(indent=...) adds.
    Same keys in the same order, same values; it is parsed and written again,
    and a body that does not parse is left as it is.
  * Text between tags loses the indentation at the start of each line and
    runs of blank lines. A browser folds that whitespace to one space either
    way, so nothing moves. Attribute values are never touched, and neither is
    anything inside <script>, <style>, <pre> or <textarea>. A page that sets
    white-space: pre (or pre-wrap) anywhere, or uses a class that does, keeps
    its whitespace entirely.
  * HTML comments are dropped, except the static-nav markers
    (scripts/inject_static_nav.py finds the baked nav by them) and
    conditional comments.

    python3 scripts/html_slim.py --selftest
"""
import json
import re
import sys

JSON_RE = re.compile(r'(<script\b[^>]*\btype="application/(?:ld\+)?json"[^>]*>)(.*?)(</script\s*>)', re.S | re.I)
RAW_RE = re.compile(r'<(script|style|pre|textarea)\b.*?</\1\s*>', re.S | re.I)
# a tag, with quoted attribute values that may hold ">"
TAG_RE = re.compile(r'''<[A-Za-z/!?](?:[^"'>]|"[^"]*"|'[^']*')*>''')
COMMENT_RE = re.compile(r"<!--(.*?)-->", re.S)
KEEP_COMMENT = re.compile(r"^\s*/?static-nav:|^\[")
# classes whose CSS sets white-space: pre or pre-wrap (components/prf.css, components/lrp.css)
PRE_CLASSES = ("prf-math",)
PRE_WS = re.compile(r"white-space\s*:\s*pre(?!-line)", re.I)


def _json(m):
    body = m.group(2)
    try:
        obj = json.loads(body)
    except ValueError:
        return m.group(0)
    out = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return m.group(1) + out + m.group(3)


def _text(seg):
    """seg is markup outside any raw element: tags and the text between them."""
    out, pos = [], 0
    for t in TAG_RE.finditer(seg):
        out.append(_ws(seg[pos:t.start()]))
        tag = t.group(0)
        if tag.startswith("<!--"):
            # TAG_RE stops a comment at its first ">"; take the whole comment
            end = seg.find("-->", t.start() + 4)
            end = len(seg) if end < 0 else end + 3
            com = seg[t.start():end]
            m = COMMENT_RE.fullmatch(com)
            out.append(com if (not m or KEEP_COMMENT.search(m.group(1))) else "")
            pos = end
            continue
        out.append(tag)
        pos = t.end()
    out.append(_ws(seg[pos:]))
    return "".join(out)


def _strip_comments(seg):
    return COMMENT_RE.sub(lambda m: m.group(0) if KEEP_COMMENT.search(m.group(1)) else "", seg)


def _ws(text):
    text = re.sub(r"\n[ \t]+", "\n", text)
    return re.sub(r"\n{2,}", "\n", text)


def _walk(html, keep_ws):
    out, pos = [], 0
    for m in RAW_RE.finditer(html):
        seg = html[pos:m.start()]
        out.append(_strip_comments(seg) if keep_ws else _text(seg))
        out.append(m.group(0))
        pos = m.end()
    seg = html[pos:]
    out.append(_strip_comments(seg) if keep_ws else _text(seg))
    return "".join(out)


def slim(html):
    html = JSON_RE.sub(_json, html)
    keep_ws = bool(PRE_WS.search(html)) or any(f'class="{c}' in html or f" {c}" in html for c in PRE_CLASSES)
    return _walk(html, keep_ws)


def selftest():
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(("ok  " if cond else "FAIL"), name)
        ok = ok and cond

    ld = '<script type="application/ld+json">\n{\n "@type": "FAQPage",\n "a": [1, 2],\n "t": "x </b> y"\n}\n</script>'
    s = slim(ld)
    ck("ld+json compact", s == '<script type="application/ld+json">{"@type":"FAQPage","a":[1,2],"t":"x <\\/b> y"}</script>')
    bad = '<script type="application/ld+json">{oops</script>'
    ck("unparsable json left alone", slim(bad) == bad)
    ck("indent dropped between tags", slim("<ul>\n    <li>a</li>\n\n\n    <li>b</li>\n</ul>") == "<ul>\n<li>a</li>\n<li>b</li>\n</ul>")
    ck("attribute with a newline kept", slim('<p title="a\n    b">x</p>') == '<p title="a\n    b">x</p>')
    ck("attribute with > kept", slim('<p data-x="a > b\n  c">\n  t</p>') == '<p data-x="a > b\n  c">\nt</p>')
    js = "<script>\n  var a = `x\n    y`;\n</script>"
    ck("script untouched", slim(js) == js)
    pre = "<pre>\n   a\n   b</pre>"
    ck("pre untouched", slim(pre) == pre)
    ck("comment dropped", slim("<p>a<!-- note > here --></p>") == "<p>a</p>")
    nav = "<!-- static-nav:header (x) -->\n<b>x</b>\n<!-- /static-nav:header -->"
    ck("static-nav markers kept", slim(nav) == nav)
    ck("inline space kept", slim("<a>x</a> <a>y</a>") == "<a>x</a> <a>y</a>")
    ck("pre-wrap page keeps its whitespace", slim('<div style="white-space:pre-wrap">\n  a</div>') == '<div style="white-space:pre-wrap">\n  a</div>')
    ck("prf-math page keeps its whitespace", slim('<div class="prf-math">\n  a</div><!-- c -->') == '<div class="prf-math">\n  a</div>')
    ck("pre-line still slimmed", slim('<div style="white-space:pre-line">\n  a</div>') == '<div style="white-space:pre-line">\na</div>')
    return ok


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    print(__doc__)
