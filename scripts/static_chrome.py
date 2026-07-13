#!/usr/bin/env python3
"""
AGSIST static-chrome rollout — fills every EMPTY #site-header / #site-footer
container on root-level pages with the canonical crawlable fallback blocks
(components/header-fallback.html, components/footer-fallback.html).

This is the pattern already live on index.html: static links inside the
container for crawlers, non-JS readers, and fetch-fail; components/loader.js
replaceWith()s the whole container for the live nav when JS runs. Container
divs and their ids are preserved — the loader keys on them.

Idempotent via sha-versioned markers. Containers that already hold UNMARKED
hand-written content (index.html and friends) are never touched — they are
reported so they can be migrated deliberately, not clobbered.
"""
import hashlib
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = {
    "HEADER": ("site-header", REPO / "components" / "header-fallback.html"),
    "FOOTER": ("site-footer", REPO / "components" / "footer-fallback.html"),
}


def marker_re(kind):
    return re.compile(
        r"<!--CHROME:FALLBACK:" + kind + r" v=([0-9a-f]{10})-->.*?"
        r"<!--/CHROME:FALLBACK:" + kind + r"-->", re.S)


def wrapped(kind, sha, content):
    return ("<!--CHROME:FALLBACK:" + kind + " v=" + sha + "-->\n"
            + content.rstrip() + "\n<!--/CHROME:FALLBACK:" + kind + "-->")


def main():
    chrome = {}
    for kind, (cid, path) in SRC.items():
        if not path.exists():
            print("FATAL: missing " + str(path))
            return 1
        content = path.read_text(encoding="utf-8")
        sha = hashlib.sha1(content.encode()).hexdigest()[:10]
        chrome[kind] = (cid, sha, content)
        print(kind.lower() + "-fallback sha " + sha)

    filled, updated, current, manual = [], [], [], []
    for page in sorted(REPO.glob("*.html")):
        src = page.read_text(encoding="utf-8")
        out = src
        for kind, (cid, sha, content) in chrome.items():
            empty = '<div id="' + cid + '"></div>'
            mre = marker_re(kind)
            m = mre.search(out)
            if m:
                if m.group(1) != sha:
                    out = mre.sub(lambda _: wrapped(kind, sha, content), out, count=1)
                    updated.append(page.name + ":" + kind.lower())
            elif empty in out:
                out = out.replace(empty,
                                  '<div id="' + cid + '">\n'
                                  + wrapped(kind, sha, content) + '\n</div>', 1)
                filled.append(page.name + ":" + kind.lower())
            elif 'id="' + cid + '"' in out:
                manual.append(page.name + ":" + kind.lower())
        if out != src:
            page.write_text(out, encoding="utf-8")
        elif page.name not in [x.split(":")[0] for x in manual]:
            current.append(page.name)

    print("filled empty containers: " + str(len(filled)) + " " + str(filled))
    print("updated marked blocks:  " + str(len(updated)) + " " + str(updated))
    print("hand-written, skipped:  " + str(len(manual)) + " " + str(manual))
    return 0


if __name__ == "__main__":
    sys.exit(main())
