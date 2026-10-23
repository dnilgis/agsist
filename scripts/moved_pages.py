#!/usr/bin/env python3
"""moved_pages.py: the pages merged into another page on Oct 22, 2026 (Sig approved the seven
merges from the Oct 21 pages board), in one table.

  MOVED       old path -> (new path, section anchor). The one list every builder and test reads.
  repoint(u)  an internal link to an old page -> its new home ("/whats-priced-in#corn" ->
              "/usda-calendar#corn"; a bare old path gets the section anchor).
  write_stubs the forward pages at the old addresses: noindex, canonical to the new page,
              the query and #hash kept (the same stub /here has used since Fast Facts).

  python3 scripts/moved_pages.py --write      (re)write the forward pages
  python3 scripts/moved_pages.py --check      exit 1 if a forward page differs from what --write makes
  python3 scripts/moved_pages.py --selftest
"""
import html as H
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# old path: (new path, anchor of the section that took it over, file at the old address, one line for the stub)
MOVED = {
    "/news": ("/daily", "moved", "news.html", "What just moved is on the Daily page now."),
    "/conditions-yield": ("/conditions", "crop-size", "conditions-yield.html",
                          "Crop size forecasts are on the crop conditions page now."),
    "/whats-priced-in": ("/usda-calendar", "priced-in", "whats-priced-in.html",
                         "What&rsquo;s priced in is on the USDA report calendar now."),
    "/scorecard": ("/usda-calendar", "scorecard", "scorecard.html",
                   "The report call scorecard is on the USDA report calendar now."),
    "/pod-counts": ("/crop-tour", "pod-counts", "pod-counts.html", "Pod counts are on the crop tour page now."),
    "/hail/": ("/hail-map", "history", "hail/index.html", "The hail storm log is on the hail map now."),
    "/cash-bids/states": ("/basis", "states", "cash-bids/states.html",
                          "Bids by state are on the basis page now."),
    "/elevators": ("/list-your-elevator", "coverage", "elevators.html",
                   "Elevator coverage and claiming a board are on List your elevator now."),
}
# Spellings that reach the same old page.
ALIASES = {"/news.html": "/news", "/conditions-yield.html": "/conditions-yield",
           "/whats-priced-in.html": "/whats-priced-in", "/scorecard.html": "/scorecard",
           "/pod-counts.html": "/pod-counts", "/hail": "/hail/", "/hail/index.html": "/hail/",
           "/cash-bids/states.html": "/cash-bids/states", "/elevators.html": "/elevators"}

_LINK = re.compile(r"^(/[^?#]*)(\?[^#]*)?(#.*)?$")


def repoint(url):
    """An internal link to a merged page -> its new home; anything else unchanged.
    The query is kept; a hash of its own is kept, else the section anchor is added."""
    if not isinstance(url, str):
        return url
    pre = ""
    if url.startswith("https://agsist.com/"):
        pre, url = "https://agsist.com", url[len("https://agsist.com"):]
    m = _LINK.match(url)
    if not m:
        return pre + url
    path, q, h = m.group(1), m.group(2) or "", m.group(3) or ""
    path = ALIASES.get(path, path)
    if path not in MOVED:
        return pre + url
    new, anchor = MOVED[path][0], MOVED[path][1]
    return pre + new + q + (h if h and h != "#" else "#" + anchor)


def stub(old):
    new, anchor, _f, line = MOVED[old]
    js = new + '"+location.search+(location.hash||"#' + anchor + '")'
    return ("<!DOCTYPE html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            f"<title>Moved | AGSIST</title>\n"
            "<meta name=\"robots\" content=\"noindex,follow\">\n"
            f"<link rel=\"canonical\" href=\"https://agsist.com{new}\">\n"
            f"<meta http-equiv=\"refresh\" content=\"0; url={new}#{anchor}\">\n"
            f"<script>location.replace(\"{js});</script>\n"
            "</head>\n<body>\n"
            "<main style=\"max-width:600px;margin:0 auto;padding:3rem 1rem;font-family:Inter,system-ui,sans-serif;text-align:center\">\n"
            f"<p>{line}</p>\n"
            f"<p><a href=\"{new}#{anchor}\" style=\"font-weight:600\">Go there &rarr;</a></p>\n"
            "</main>\n</body>\n</html>\n")


def write_stubs(check=False):
    bad = []
    for old, (_n, _a, f, _l) in MOVED.items():
        p = os.path.join(ROOT, f)
        want = stub(old)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != want:
            bad.append(f)
            if not check:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "w", encoding="utf-8").write(want)
    return bad


def selftest():
    ok = 0

    def eq(a, b):
        nonlocal ok
        assert a == b, (a, b)
        ok += 1
    eq(repoint("/news"), "/daily#moved")
    eq(repoint("/whats-priced-in#corn"), "/usda-calendar#corn")
    eq(repoint("/whats-priced-in?x=1"), "/usda-calendar?x=1#priced-in")
    eq(repoint("/scorecard.html"), "/usda-calendar#scorecard")
    eq(repoint("/hail"), "/hail-map#history")
    eq(repoint("/hail/"), "/hail-map#history")
    eq(repoint("/hail/2026-06-02"), "/hail/2026-06-02")
    eq(repoint("/cash-bids/states"), "/basis#states")
    eq(repoint("/cash-bids/iowa"), "/cash-bids/iowa")
    eq(repoint("https://agsist.com/elevators"), "https://agsist.com/list-your-elevator#coverage")
    eq(repoint("/newsletter"), "/newsletter")
    eq(repoint("/daily"), "/daily")
    eq(repoint(None), None)
    s = stub("/news")
    assert len(s.encode()) < 1536 and 'content="noindex,follow"' in s and "location.search" in s
    assert 'href="https://agsist.com/daily"' in s and "—" not in s
    ok += 1
    print(f"moved_pages selftest: {ok} passed")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        selftest()
    elif "--check" in a:
        b = write_stubs(check=True)
        print("forward pages: " + ("out of date: " + ", ".join(b) if b else "all current"))
        sys.exit(1 if b else 0)
    elif "--write" in a:
        print("wrote: " + (", ".join(write_stubs()) or "nothing (all current)"))
    else:
        print(__doc__)
