#!/usr/bin/env python3
"""desk_tabs.py: Sig's admin pages folded into /desk as tabs (Oct 28, 2026, Sig: "can't you reuse
the elevator page and create a singular dashboard?"), in one table.

  TABS        old file -> (desk tab, the page that now holds it, one line for the stub)
  stub(old)   the forward page at the old address: noindex, canonical to /desk, the query kept and
              the old #hash carried after the tab (/haymow-admin#abc -> /desk#haymow/abc), so every
              bookmark, email link and installed bookmarklet still lands on the same tool. The same
              stub shape as scripts/moved_pages.py (the Oct 22 page merges) uses.

  python3 scripts/desk_tabs.py --write      (re)write the forward pages
  python3 scripts/desk_tabs.py --check      exit 1 if a forward page differs from what --write makes
  python3 scripts/desk_tabs.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TABS = {
    "elev-admin.html": ("elevators", "desk/elevators.html", "The elevator desk is a tab on the desk now."),
    "elev-today.html": ("today", "desk/today.html", "The Today list is a tab on the desk now."),
    "haymow-admin.html": ("haymow", "desk/haymow.html", "The Haymow desk is a tab on the desk now."),
    "rp-gift-admin.html": ("gifts", "desk/gifts.html", "The gift card desk is a tab on the desk now."),
}


def target(tab, search="", hash_=""):
    """Where the stub sends a visit: /desk?<query>#<tab>[/<old hash>]."""
    h = hash_[1:] if hash_.startswith("#") else hash_
    return "/desk" + search + "#" + tab + ("/" + h if h else "")


def stub(old):
    tab, _page, line = TABS[old]
    js = ('location.replace("/desk"+location.search+"#' + tab +
          '"+(location.hash.length>1?"/"+location.hash.slice(1):""));')
    return ("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "<title>Moved | AGSIST</title>\n"
            "<meta name=\"robots\" content=\"noindex, nofollow\">\n"
            "<meta name=\"referrer\" content=\"no-referrer\">\n"
            "<link rel=\"canonical\" href=\"https://agsist.com/desk\">\n"
            f"<meta http-equiv=\"refresh\" content=\"0; url=/desk#{tab}\">\n"
            f"<script>{js}</script>\n"
            "</head>\n<body>\n"
            "<main style=\"max-width:600px;margin:0 auto;padding:3rem 1rem;font-family:system-ui,sans-serif;text-align:center\">\n"
            f"<p>{line}</p>\n"
            f"<p><a href=\"/desk#{tab}\" style=\"font-weight:600\">Go there &rarr;</a></p>\n"
            "</main>\n</body>\n</html>\n")


def write_stubs(check=False):
    bad = []
    for old in TABS:
        p = os.path.join(ROOT, old)
        want = stub(old)
        have = open(p, encoding="utf-8").read() if os.path.exists(p) else None
        if have != want:
            bad.append(old)
            if not check:
                open(p, "w", encoding="utf-8").write(want)
    return bad


def selftest():
    assert target("haymow", "", "#cccccccccc") == "/desk#haymow/cccccccccc"
    assert target("elevators", "?paste=newcoop", "#paste") == "/desk?paste=newcoop#elevators/paste"
    assert target("today") == "/desk#today"
    for old, (tab, page, _l) in TABS.items():
        s = stub(old)
        assert 'content="noindex, nofollow"' in s and "#" + tab in s, old
        assert os.path.exists(os.path.join(ROOT, page)), page
        assert "—" not in s
    print("desk_tabs selftest: ok")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        selftest()
    elif "--check" in a:
        bad = write_stubs(check=True)
        if bad:
            print("forward pages differ: " + ", ".join(bad) + " (run python3 scripts/desk_tabs.py --write)")
            sys.exit(1)
        print("desk_tabs: forward pages ok")
    elif "--write" in a:
        print("wrote: " + (", ".join(write_stubs()) or "nothing changed"))
    else:
        print(__doc__)
