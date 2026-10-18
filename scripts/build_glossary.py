#!/usr/bin/env python3
"""build_glossary.py: writes the word list and its structured data on /glossary
from data/glossary.json, the same file components/glossary.js reads, so the
page and the tap-to-explain marks on other pages always say the same thing.

    python3 scripts/build_glossary.py           write glossary.html
    python3 scripts/build_glossary.py --check   exit 1 if glossary.html is stale

Stdlib only. Offline.
"""
import html
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(REPO, "glossary.html")
DATA = os.path.join(REPO, "data", "glossary.json")
URL = "https://agsist.com/glossary"


def e(s):
    return html.escape(s, quote=True)


def body(terms):
    out = ['      <ul class="jump" aria-label="Words on this page">']
    for t in terms:
        out.append(f'        <li><a href="#{t["id"]}">{e(t["term"])}</a></li>')
    out.append("      </ul>")
    for t in terms:
        out.append(f'      <section id="{t["id"]}">')
        out.append(f'        <h2>{e(t["q"])}</h2>')
        out.append(f'        <p class="short">{e(t["short"])}</p>')
        out.append(f'        <p>{e(t["long"])}</p>')
        links = [f'<a href="{e(s["href"])}">{e(s["text"])}</a>' for s in t.get("see", [])]
        line = ""
        if links:
            line += "On AGSIST: " + " &middot; ".join(links) + "."
        if t.get("source"):
            s = t["source"]
            line += (" " if line else "") + f'Source: <a href="{e(s["href"])}" rel="noopener">{e(s["text"])}</a>.'
        if line:
            out.append(f'        <p class="more">{line}</p>')
        out.append("      </section>")
    return "\n" + "\n".join(out) + "\n"


def ld(terms, updated):
    graph = [
        {"@type": "WebPage", "@id": URL + "#page", "name": "Farm market glossary", "url": URL,
         "description": "Plain definitions of the farm market words AGSIST uses.",
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
         "datePublished": "2026-10-18", "dateModified": updated, "inLanguage": "en-US"},
        {"@type": "DefinedTermSet", "@id": URL + "#terms", "name": "AGSIST farm market glossary",
         "hasDefinedTerm": [{"@type": "DefinedTerm", "@id": URL + "#" + t["id"], "name": t["term"],
                             "description": t["short"], "url": URL + "#" + t["id"]} for t in terms]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Glossary", "item": URL}]},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": t["q"], "acceptedAnswer": {"@type": "Answer", "text": t["short"] + " " + t["long"]}}
            for t in terms]},
    ]
    return '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":")) + "</script>"


def render(src, data):
    terms = data["terms"]
    src = re.sub(r"<!--GLOSSARY:BODY-->.*?<!--/GLOSSARY:BODY-->",
                 lambda m: "<!--GLOSSARY:BODY-->" + body(terms) + "<!--/GLOSSARY:BODY-->", src, flags=re.S)
    src = re.sub(r"<!--GLOSSARY:LD-->.*?<!--/GLOSSARY:LD-->",
                 lambda m: "<!--GLOSSARY:LD-->" + ld(terms, data.get("updated", "2026-10-18")) + "<!--/GLOSSARY:LD-->", src, flags=re.S)
    return src


def main(argv):
    data = json.load(open(DATA, encoding="utf-8"))
    src = open(PAGE, encoding="utf-8").read()
    new = render(src, data)
    if "--check" in argv:
        if new != src:
            print("glossary.html is stale: run python3 scripts/build_glossary.py")
            return 1
        print("glossary.html matches data/glossary.json")
        return 0
    if new != src:
        open(PAGE, "w", encoding="utf-8").write(new)
    print(f"glossary.html: {len(data['terms'])} terms")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
