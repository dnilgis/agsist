#!/usr/bin/env python3
"""
build_changelog.py  —  AGSIST /changelog page baker.

Reads data/changelog.json and bakes the entry list, the "log updated" stamp,
and the head dateModified into changelog.html, in place, between stable marker
comments. Entries land as STATIC HTML — no client-side fetch — so readers,
search engines, and JS-blind crawlers all see the same page.

Update flow (same pattern as build_farmbill.py):
    1. edit data/changelog.json  (newest entry FIRST — the baker enforces order)
    2. run:  python3 scripts/build_changelog.py

Idempotent: running twice with the same JSON produces a byte-identical file.
Self-validating: refuses to write if the result fails the structure gauntlet.

Usage:
    python3 scripts/build_changelog.py            # bake in place
    python3 scripts/build_changelog.py --check    # verify only, write nothing (CI-safe)
    python3 scripts/build_changelog.py --html PATH --json PATH
"""

import argparse
import json
import re
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

TAGS = {"new": "New", "improved": "Improved", "fixed": "Fixed"}

MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def pretty_date(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m]} {d}, {y}"


def validate(data):
    """Fail loudly on anything that would bake a dishonest or broken page."""
    assert isinstance(data.get("entries"), list) and data["entries"], "entries missing/empty"
    prev = None
    n_items = 0
    for e in data["entries"]:
        iso = e["date"]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso), f"bad date {iso!r}"
        date.fromisoformat(iso)  # raises on impossible dates
        if prev is not None:
            assert iso < prev, f"entries must be newest-first ({iso} after {prev})"
        prev = iso
        assert e.get("items"), f"{iso}: no items"
        for it in e["items"]:
            assert it.get("tag") in TAGS, f"{iso}: bad tag {it.get('tag')!r}"
            assert it.get("page", "").startswith("/"), f"{iso}: page must be a site path"
            assert it.get("name", "").strip(), f"{iso}: item missing name"
            txt = it.get("text", "").strip()
            assert len(txt) >= 20, f"{iso}: item text too short to mean anything"
            for ch in txt + it["name"]:
                cp = ord(ch)
                assert not (0x1F000 <= cp <= 0x1FAFF or 0x2600 <= cp <= 0x27BF), \
                    f"{iso}: emoji {ch!r} in reader copy"
    for e in data["entries"]:
        n_items += len(e["items"])
    assert data["entries"][0]["date"] == data.get("updated"), \
        "top-level 'updated' must equal the newest entry date"
    return n_items


def render_entries(data):
    out = []
    for e in data["entries"]:
        out.append(f'<section class="cl-day"><h2 class="cl-date">{pretty_date(e["date"])}</h2>'
                   f'<div class="cl-items">')
        for it in e["items"]:
            tag = it["tag"]
            out.append(
                f'<div class="cl-item"><div class="cl-top">'
                f'<span class="cl-tag cl-tag--{tag}">{TAGS[tag]}</span>'
                f'<a class="cl-page" href="{esc(it["page"])}">{esc(it["name"])}</a>'
                f'</div><p class="cl-text">{esc(it["text"])}</p></div>')
        out.append('</div></section>')
    return "".join(out)


def render_stamp(data, n_items):
    return (f'Log updated {pretty_date(data["updated"])} &middot; '
            f'{n_items} changes across {len(data["entries"])} days')


def splice(html, name, body):
    a, b = f"<!-- CHANGELOG:{name} -->", f"<!-- /CHANGELOG:{name} -->"
    pat = re.compile(re.escape(a) + r".*?" + re.escape(b), re.S)
    assert len(pat.findall(html)) == 1, f"marker {name}: expected exactly 1 region"
    return pat.sub(lambda _: a + body + b, html)


class DivBalance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth = 0
        self.bad = False

    def handle_starttag(self, t, a):
        if t == "div":
            self.depth += 1

    def handle_endtag(self, t):
        if t == "div":
            self.depth -= 1
            if self.depth < 0:
                self.bad = True


def gauntlet(html):
    p = DivBalance()
    p.feed(html)
    assert not p.bad and p.depth == 0, "div balance broken"
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert m, "JSON-LD block missing"
    json.loads(m.group(1))  # raises if the bake corrupted it
    assert html.count("cl-day") >= 2, "suspiciously few baked entries"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "changelog.html"
    json_path = Path(args.json) if args.json else root / "data" / "changelog.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    n_items = validate(data)

    html = html_path.read_text(encoding="utf-8")
    baked = splice(html, "entries", render_entries(data))
    baked = splice(baked, "stamp", render_stamp(data, n_items))
    baked, n = re.subn(r'("dateModified":")\d{4}-\d{2}-\d{2}(")',
                       r'\g<1>' + data["updated"] + r'\g<2>', baked)
    assert n == 1, f"expected exactly 1 dateModified in head, found {n}"

    gauntlet(baked)

    if baked == html:
        print("changelog.html already in sync.")
        return 0
    if args.check:
        print("changelog.html OUT OF SYNC with data/changelog.json — run the baker.")
        return 1
    html_path.write_text(baked, encoding="utf-8")
    print(f"Baked changelog.html — {n_items} items, {len(data['entries'])} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
