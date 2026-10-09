#!/usr/bin/env python3
"""
check_cot_baked.py: does cot.html say what data/cot.json says?

cot.html carries hard numbers in its title, meta descriptions and crawler
summary, baked from data/cot.json by scripts/bake_seo.py (seo_cot) and
scripts/prerender_wpi_scorecard.py (bake_cot). On 2026-10-09 the watcher
committed the Oct 6 report while its bake step had died on a SyntaxError
under Python 3.11, so the page title kept saying "Net Long Corn 381k"
(Sept 29) over 330k data. The run was red, but the data commit looked
complete.

This re-runs both bakers in memory against the files on disk and exits 1 if
either would change cot.html. It writes nothing.

    python3 scripts/check_cot_baked.py            # check the repository
    python3 scripts/check_cot_baked.py --selftest
"""

import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)


def stale_parts(today=None):
    """Names of the cot.html parts that do not match data/cot.json."""
    import bake_seo
    import prerender_wpi_scorecard as pre
    cwd = os.getcwd()
    os.chdir(ROOT)                      # prerender_wpi_scorecard uses relative paths
    try:
        src = open("cot.html", encoding="utf-8").read()
        bad = []
        fn, owns = bake_seo.PAGES["cot.html"]
        got = fn(bake_seo.build_ctx(today or date.today()))
        if not got:
            bad.append("head tags (seo_cot found no corn net in data/cot.json)")
        else:
            out, n = bake_seo.stamp(src, got[0], got[1], owns)
            if n != bake_seo.expected_tags(owns):
                bad.append("head tags (markup changed: stamped %d tags)" % n)
            elif out != src:
                bad.append("head tags (title should be %r)" % got[0])
        orig, new, _ = pre.bake_cot()
        if new != orig:
            bad.append("crawler summary (cot-summary region)")
        return bad
    finally:
        os.chdir(cwd)


def selftest():
    import bake_seo
    fails = []
    src = "<title>Managed Money Is Net Long Corn 381k: CFTC COT</title>"
    out, _ = bake_seo.stamp(src, "Managed Money Is Net Long Corn 330k: CFTC COT", "d",
                            frozenset({"title"}))
    if out == src:
        fails.append("stamp did not change a stale title, so the check could never fire")
    print("ok   a stale title is a difference" if not fails else "FAIL " + fails[-1])
    print("\n%d failed" % len(fails) if fails else "\nall check_cot_baked checks passed")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    bad = stale_parts()
    if bad:
        for b in bad:
            print("::error::cot.html is not baked from data/cot.json: %s" % b)
        print("Run: python3 scripts/bake_seo.py --page cot.html, then bake_cot() from "
              "scripts/prerender_wpi_scorecard.py, and commit cot.html.")
        return 1
    print("cot.html matches data/cot.json")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
