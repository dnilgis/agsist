#!/usr/bin/env python3
"""What's new: data/whats-new.json drives two places.

  index.html     one small line at the end of the page, above the byline:
                 a link to /changelog and the newest entry. Until Oct 20 this
                 was a card of the newest four near the top, which sat above
                 Cash bids on a phone (panel Oct 20, seats A and G; Sig's
                 "after main content" rule). The card and its hide buttons
                 are gone; the entries live on /changelog.
  changelog.html every entry, as day sections above the older hand-written
                 log, which is kept as it is; the stamp line is recounted.

  python3 scripts/build_whats_new.py          write both pages
  python3 scripts/build_whats_new.py --check  fail if either page is stale
"""
import datetime as dt
import html
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "whats-new.json")
INDEX = os.path.join(REPO, "index.html")
CHANGELOG = os.path.join(REPO, "changelog.html")
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def esc(s):
    return html.escape(s, quote=True)


def load():
    d = json.load(open(DATA, encoding="utf-8"))
    items = d["items"]
    for it in items:
        dt.date.fromisoformat(it["date"])
        for k in ("id", "title", "line", "link"):
            if not it.get(k):
                raise SystemExit("whats-new item missing %s: %r" % (k, it))
        if "—" in it["title"] + it["line"]:
            raise SystemExit("em dash in whats-new item " + it["id"])
    dates = [it["date"] for it in items]
    if dates != sorted(dates, reverse=True):
        raise SystemExit("data/whats-new.json must be newest first")
    if len({it["id"] for it in items}) != len(items):
        raise SystemExit("data/whats-new.json ids must be unique")
    return items


def short_date(iso):
    d = dt.date.fromisoformat(iso)
    return "%s %d" % (MONTHS[d.month - 1][:3], d.day)


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    return "%s %d, %d" % (MONTHS[d.month - 1], d.day, d.year)


def changelog_html(items):
    days, order = {}, []
    for it in items:
        if it["date"] not in days:
            days[it["date"]] = []
            order.append(it["date"])
        days[it["date"]].append(it)
    out = []
    for d in order:
        cells = "".join(
            '<div class="cl-item" id="%s"><div class="cl-top"><span class="cl-tag cl-tag--new">New</span>'
            '<a class="cl-page" href="%s">%s</a></div><p class="cl-text">%s</p></div>'
            % (esc(it["id"]), esc(it["link"]), esc(it["title"]), esc(it["line"])) for it in days[d])
        out.append('<section class="cl-day"><h2 class="cl-date">%s</h2><div class="cl-items">%s</div></section>'
                   % (long_date(d), cells))
    return "<!-- WHATSNEW:entries -->" + "".join(out) + "<!-- /WHATSNEW:entries -->"


def replace_block(src, start, end, new, fallback_before=None):
    i, j = src.find(start), src.find(end)
    if i >= 0 and j > i:
        return src[:i] + new + src[j + len(end):]
    if fallback_before is None or fallback_before not in src:
        raise SystemExit("marker not found: " + start)
    k = src.index(fallback_before)
    return src[:k] + new + "\n" + src[k:]


def link_html(items):
    it = items[0]
    return ('<!-- WHATSNEW:link (scripts/build_whats_new.py from data/whats-new.json; do not edit by hand) -->'
            '<p class="wn-link" style="font-size:.84rem;color:var(--text-dim);margin:1.2rem 0 0">'
            '<a href="/changelog">What&rsquo;s new</a> &middot; latest: <a href="%s">%s</a>, %s</p>'
            '<!-- /WHATSNEW:link -->\n' % (esc(it["link"]), esc(it["title"]), short_date(it["date"])))


def build_index(src, items):
    i, j = src.find("<!-- WHATSNEW:card"), src.find("<!-- /WHATSNEW:card -->")
    if i >= 0 and j > i:                      # the old card, retired Oct 20
        k = j + len("<!-- /WHATSNEW:card -->")
        src = src[:i] + src[k + (1 if src[k:k + 1] == "\n" else 0):]
    i, j = src.find("<!-- WHATSNEW:link"), src.find("<!-- /WHATSNEW:link -->")
    if i >= 0 and j > i:
        k = j + len("<!-- /WHATSNEW:link -->")
        src = src[:i] + src[k + (1 if src[k:k + 1] == "\n" else 0):]
    k = src.index('<p class="by-end"')
    return src[:k] + link_html(items) + src[k:]


def build_changelog(src, items):
    src = replace_block(src, "<!-- WHATSNEW:entries -->", "<!-- /WHATSNEW:entries -->", changelog_html(items),
                        fallback_before="<!-- CHANGELOG:entries -->")
    src = src.replace(changelog_html(items) + "\n<!-- CHANGELOG:entries -->", changelog_html(items) + "<!-- CHANGELOG:entries -->")
    lst = src[src.index("<!-- WHATSNEW:entries -->"):src.index("<!-- /CHANGELOG:entries -->")]
    n_items = lst.count('class="cl-item"')
    n_days = len(set(re.findall(r'<h[23] class="cl-date">(.*?)</h[23]>', lst, flags=re.S)))
    stamp = "Log updated %s &middot; %d changes across %d days" % (long_date(items[0]["date"]), n_items, n_days)
    return re.sub(r"(<!-- CHANGELOG:stamp -->).*?(<!-- /CHANGELOG:stamp -->)", lambda m: m.group(1) + stamp + m.group(2), src, flags=re.S)


def main():
    items = load()
    jobs = [(INDEX, build_index), (CHANGELOG, build_changelog)]
    stale = []
    for path, fn in jobs:
        src = open(path, encoding="utf-8").read()
        new = fn(src, items)
        if new != src:
            if "--check" in sys.argv:
                stale.append(os.path.relpath(path, REPO))
            else:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
                print("wrote " + os.path.relpath(path, REPO))
    if stale:
        print("stale (run scripts/build_whats_new.py): " + ", ".join(stale))
        sys.exit(1)
    if "--check" in sys.argv:
        print("index.html and changelog.html match data/whats-new.json")


if __name__ == "__main__":
    main()
