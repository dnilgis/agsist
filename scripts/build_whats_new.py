#!/usr/bin/env python3
"""What's new: one file per entry in data/whats-new/, built into three places.

  data/whats-new/<YYYY-MM-DD>-<slug>.json   one entry: id (the file name without .json), date,
                 title, line, link, and an optional rank (within one day, higher shows first;
                 left out, the day's entries without one follow, by id). A pull request adds
                 only its entry file; the three built files below are rebuilt on main
                 (.github/workflows/main-checks.yml, scripts/dev/main_build.py) and never edited
                 in a pull request (the built-files guard fails it).

  data/whats-new.json   every entry, newest first (the combined list the site and feeds read)

  index.html     one small line at the end of the page, above the byline:
                 a link to /changelog and the newest entry. Until Oct 20 this
                 was a card of the newest four near the top, which sat above
                 Cash bids on a phone (panel Oct 20, seats A and G; Sig's
                 "after main content" rule). The card and its hide buttons
                 are gone; the entries live on /changelog.
  changelog.html every entry, as day sections above the older hand-written
                 log, which is kept as it is; the stamp line is recounted.

  python3 scripts/build_whats_new.py            write all three
  python3 scripts/build_whats_new.py --check    fail if any of the three is stale
  python3 scripts/build_whats_new.py --validate check the entry files only, write nothing
  python3 scripts/build_whats_new.py --list     print the entries, in order, as JSON
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime as dt
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_changelog as build_changelog_py  # noqa: E402  (the shared stamp line)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRIES = os.path.join(REPO, "data", "whats-new")
DATA = os.path.join(REPO, "data", "whats-new.json")
FIELDS = ("id", "date", "title", "line", "link")
NOTE = ("What's new on AGSIST, newest first. Built from one file per entry in data/whats-new/ by "
        "scripts/build_whats_new.py on main (never edited by hand): the newest entry goes into the "
        "homepage line and every entry into /changelog (above the older hand-written log). Only things "
        "that are live on the site. Plain words, no em dashes.")
INDEX = os.path.join(REPO, "index.html")
CHANGELOG = os.path.join(REPO, "changelog.html")
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def esc(s):
    return html.escape(s, quote=True)


def load(folder=ENTRIES):
    items, bad = [], []
    names = sorted(f for f in os.listdir(folder) if not f.startswith("."))
    for f in names:
        path = os.path.join(folder, f)
        if not f.endswith(".json"):
            bad.append("%s: not a .json entry" % f)
            continue
        try:
            it = json.load(open(path, encoding="utf-8"))
        except ValueError as e:
            bad.append("%s: not JSON (%s)" % (f, e))
            continue
        if not isinstance(it, dict):
            bad.append("%s: not an object" % f)
            continue
        extra = set(it) - set(FIELDS) - {"rank"}
        if extra:
            bad.append("%s: unknown field(s) %s" % (f, ", ".join(sorted(extra))))
        for k in FIELDS:
            if not isinstance(it.get(k), str) or not it.get(k).strip():
                bad.append("%s: missing %s" % (f, k))
        if bad and bad[-1].startswith(f + ":"):
            continue
        try:
            dt.date.fromisoformat(it["date"])
        except ValueError:
            bad.append("%s: bad date %r" % (f, it["date"]))
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*", it["id"]):
            bad.append("%s: id %r is not <YYYY-MM-DD>-<slug> (lowercase, digits, dashes)" % (f, it["id"]))
        if f != it["id"] + ".json":
            bad.append("%s: the file name must be the id plus .json (%s.json)" % (f, it["id"]))
        if not it["id"].startswith(it["date"] + "-"):
            bad.append("%s: the id must start with its date %s" % (f, it["date"]))
        if "rank" in it and (not isinstance(it["rank"], int) or isinstance(it["rank"], bool)):
            bad.append("%s: rank must be a whole number" % f)
        if "\u2014" in it["title"] + it["line"]:
            bad.append("%s: em dash" % f)
        if not it["link"].startswith("/"):
            bad.append("%s: link must be a site path starting with /" % f)
        items.append(it)
    if bad:
        raise SystemExit("data/whats-new entries:\n  " + "\n  ".join(bad))
    if not items:
        raise SystemExit("data/whats-new has no entries")
    if len({it["id"] for it in items}) != len(items):
        raise SystemExit("data/whats-new ids must be unique")
    items.sort(key=lambda it: it["id"])
    items.sort(key=lambda it: it.get("rank", 0), reverse=True)
    items.sort(key=lambda it: it["date"], reverse=True)
    return [{k: it[k] for k in FIELDS} for it in items]


def data_json(items):
    lines = ['{', ' "note": %s,' % json.dumps(NOTE, ensure_ascii=False), ' "items": [']
    for i, it in enumerate(items):
        body = json.dumps(it, indent=1, ensure_ascii=False).replace("\n", "\n  ")
        lines.append("  " + body + ("," if i < len(items) - 1 else ""))
    lines += [' ]', '}', '']
    return "\n".join(lines)


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
            % (esc(it["id"]), esc(build_changelog_py.live_href(it["link"])), esc(it["title"]), esc(it["line"])) for it in days[d])
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
    # an entry that names a page which became a moved-page stub links where the stub sends readers
    # (build_changelog.live_href); none of this block's links may land on a stub
    stubbed = sorted({it["link"] for it in items if build_changelog_py.live_href(build_changelog_py.live_href(it["link"])) != build_changelog_py.live_href(it["link"])})
    assert not stubbed, "what's new links land on redirect stubs: %s" % stubbed
    src = replace_block(src, "<!-- WHATSNEW:entries -->", "<!-- /WHATSNEW:entries -->", changelog_html(items),
                        fallback_before="<!-- CHANGELOG:entries -->")
    src = src.replace(changelog_html(items) + "\n<!-- CHANGELOG:entries -->", changelog_html(items) + "<!-- CHANGELOG:entries -->")
    return build_changelog_py.finish_page(src)


def build_data(src, items):
    return data_json(items)


# The move to one file per entry (Oct 29, 2026): a branch made before it may still add its line to
# data/whats-new.json, and merge after it. Until this date a build on main keeps such a line by
# writing its entry file (main-checks.yml commits data/whats-new/ with the built files) instead of
# dropping it. After it, a line with no entry file is gone on the next build, which is how an
# entry is taken down: delete its file.
ADOPT_UNTIL = "2026-11-07"


def adopt(today=None):
    today = today or dt.datetime.now(dt.timezone.utc).date().isoformat()
    if today > ADOPT_UNTIL or not os.path.exists(DATA):
        return []
    have = {f[:-5] for f in os.listdir(ENTRIES) if f.endswith(".json")}
    out = []
    for it in json.load(open(DATA, encoding="utf-8")).get("items", []):
        if isinstance(it, dict) and it.get("id") and it["id"] not in have and re.fullmatch(r"[a-z0-9-]+", it["id"]):
            with open(os.path.join(ENTRIES, it["id"] + ".json"), "w", encoding="utf-8") as fh:
                json.dump({k: it.get(k) for k in FIELDS}, fh, indent=1, ensure_ascii=False)
                fh.write("\n")
            out.append(it["id"])
            print("kept %s: it was in data/whats-new.json with no entry file, so its entry file is written" % it["id"])
    return out


def main():
    if not ({"--check", "--validate", "--list"} & set(sys.argv)):
        adopt()
    items = load()
    if "--validate" in sys.argv:
        print("%d entries in data/whats-new are valid" % len(items))
        return
    if "--list" in sys.argv:
        print(json.dumps(items, indent=1, ensure_ascii=False))
        return
    jobs = [(DATA, build_data), (INDEX, build_index), (CHANGELOG, build_changelog)]
    stale = []
    for path, fn in jobs:
        src = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
        new = fn(src, items)
        if new != src:
            if "--check" in sys.argv:
                stale.append(os.path.relpath(path, REPO))
            else:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(new)
                print("wrote " + os.path.relpath(path, REPO))
    if stale:
        print("stale: " + ", ".join(stale) + " (built on main from data/whats-new/; to see them as main will, "
              "run python3 scripts/build_whats_new.py and do not commit the result)")
        sys.exit(1)
    if "--check" in sys.argv:
        print("data/whats-new.json, index.html and changelog.html match data/whats-new/")


if __name__ == "__main__":
    main()
