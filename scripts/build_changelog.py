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
    python3 scripts/build_changelog.py --validate # the data and a bake to memory pass; ignores the page on disk

changelog.html is rebuilt on main (scripts/dev/main_build.py, .github/workflows/main-checks.yml):
a pull request edits data/changelog.json only, never changelog.html's baked blocks.
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
            # Sig's rule: this log is for farmers, and it does not talk about AI.
            low = (txt + " " + it["name"]).lower()
            for banned in (" ai ", "ai assistant", "chatgpt", "claude", "llm",
                           "perplexity", "gemini", "artificial intelligence"):
                assert banned not in low, \
                    f"{iso}: {banned.strip()!r} in reader copy - no AI references in the changelog"
    for e in data["entries"]:
        n_items += len(e["items"])
    assert data["entries"][0]["date"] == data.get("updated"), \
        "top-level 'updated' must equal the newest entry date"
    return n_items


OPEN_DAYS = 14  # days shown open, counted back from the newest entry (not the clock, so the bake stays idempotent)


ROOT = Path(__file__).resolve().parent.parent
STUB_RE = re.compile(r'http-equiv=["\']refresh["\']', re.I)
CANON_RE = re.compile(r'<link rel="canonical" href="https://agsist\.com(/[^"]*)"')


def live_href(page, root=ROOT):
    """An old entry can name a page that is now a redirect stub. Link where the
    stub sends readers (its canonical), so no click on this page depends on a
    stub. The stub file is the one record of where a page went."""
    path, sep, frag = page.partition("#")
    f = root / (path.strip("/") + ".html") if path.strip("/") else None
    if not f or not f.is_file():
        return page
    html = f.read_text(encoding="utf-8")
    m = CANON_RE.search(html)
    if not STUB_RE.search(html) or not m:
        return page
    dest = m.group(1)
    return dest + (sep + frag if frag and "#" not in dest else "")


def render_day(e, h="h2"):
    out = [f'<section class="cl-day"><{h} class="cl-date">{pretty_date(e["date"])}</{h}>'
           f'<div class="cl-items">']
    for it in e["items"]:
        tag = it["tag"]
        out.append(
            f'<div class="cl-item"><div class="cl-top">'
            f'<span class="cl-tag cl-tag--{tag}">{TAGS[tag]}</span>'
            f'<a class="cl-page" href="{esc(live_href(it["page"]))}">{esc(it["name"])}</a>'
            f'</div><p class="cl-text">{esc(it["text"])}</p></div>')
    out.append('</div></section>')
    return "".join(out)


def render_entries(data):
    """The last OPEN_DAYS days render open; older days fold into one <details> per month,
    so a phone reader is not handed every entry at once. Every entry stays in the HTML."""
    newest = date.fromisoformat(data["entries"][0]["date"])
    out, months = [], []
    for e in data["entries"]:
        if (newest - date.fromisoformat(e["date"])).days < OPEN_DAYS:
            out.append(render_day(e))
        else:
            ym = e["date"][:7]
            if not months or months[-1][0] != ym:
                months.append((ym, []))
            months[-1][1].append(e)
    if months:
        out.append('<h2 class="cl-older-h">Older changes, by month</h2>')
        for ym, days in months:
            y, m = (int(x) for x in ym.split("-"))
            n = sum(len(e["items"]) for e in days)
            out.append(f'<details class="cl-month"><summary>{MONTHS[m]} {y}'
                       f'<span class="cl-month-n">{n} change{"s" if n != 1 else ""}</span></summary>'
                       + "".join(render_day(e, "h3") for e in days) + '</details>')
    return "".join(out)


def finish_page(html):
    """The stamp line and the head dateModified, counted from the page itself: every entry from
    the What's new block (scripts/build_whats_new.py) through the end of this log. Both bakers
    call this, so either one can run last and the other's --check still holds."""
    a = html.find("<!-- WHATSNEW:entries -->")
    if a < 0:
        a = html.index("<!-- CHANGELOG:entries -->")
    lst = html[a:html.index("<!-- /CHANGELOG:entries -->")]
    n_items = lst.count('class="cl-item"')
    days = set(re.findall(r'<h[23] class="cl-date">(.*?)</h[23]>', lst, flags=re.S))
    iso = []
    for d in days:
        m = re.fullmatch(r"\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})\s*", d)
        assert m and m.group(1) in MONTHS, f"day heading {d!r} is not a date"
        iso.append(date(int(m.group(3)), MONTHS.index(m.group(1)), int(m.group(2))).isoformat())
    newest = max(iso)
    stamp = f"Log updated {pretty_date(newest)} &middot; {n_items} changes across {len(days)} days"
    html = splice(html, "stamp", stamp)
    html, n = re.subn(r'("dateModified":")\d{4}-\d{2}-\d{2}(")', r'\g<1>' + newest + r'\g<2>', html)
    assert n == 1, f"expected exactly 1 dateModified in head, found {n}"
    return html


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
    hrefs = re.findall(r'class="cl-page" href="([^"]*)"', html)
    assert len(hrefs) >= 20, f"only {len(hrefs)} entry links baked"
    # This builder owns the CHANGELOG:entries block. The WHATSNEW:entries block above it is
    # scripts/build_whats_new.py's, which runs after this one on main and checks its own links the
    # same way (a page that became a stub would otherwise stop this build before that block is rebuilt).
    own = re.search(r"<!-- CHANGELOG:entries -->.*?<!-- /CHANGELOG:entries -->", html, re.S)
    own_hrefs = re.findall(r'class="cl-page" href="([^"]*)"', own.group(0)) if own else hrefs
    stubbed = sorted({h for h in own_hrefs if live_href(h) != h})
    assert not stubbed, f"entry links land on redirect stubs: {stubbed}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--validate", action="store_true", help="check data/changelog.json and that the bake works; write nothing")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "changelog.html"
    json_path = Path(args.json) if args.json else root / "data" / "changelog.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    n_items = validate(data)

    html = html_path.read_text(encoding="utf-8")
    baked = finish_page(splice(html, "entries", render_entries(data)))

    gauntlet(baked)

    if args.validate:
        print(f"data/changelog.json is valid: {n_items} items, {len(data['entries'])} days; the bake passes.")
        return 0

    if baked == html:
        print("changelog.html already in sync.")
        return 0
    if args.check:
        print("changelog.html OUT OF SYNC with data/changelog.json (it is rebuilt on main; "
              "run python3 scripts/build_changelog.py to see it, and do not commit the result)")
        return 1
    html_path.write_text(baked, encoding="utf-8")
    print(f"Baked changelog.html: {n_items} items, {len(data['entries'])} days.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
