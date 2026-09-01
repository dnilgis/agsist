#!/usr/bin/env python3
"""
THE FEED MANIFEST MUST STAY TRUE.

A manifest is only worth having if it cannot quietly fall behind the site. This
regenerates it and fails if the committed copy differs — so adding a page that
fetches a new data file, or a workflow that stops writing one, turns red here
rather than leaving a feed nobody is watching.

    python3 scripts/test_feeds.py

No network. Under a second.
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAN = os.path.join(ROOT, "data", "feeds.json")
FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  — " + detail))
    if not ok:
        FAILED.append(name)
    return ok


def main():
    before = open(MAN).read() if os.path.exists(MAN) else None

    print("the manifest is current")
    r = subprocess.run([sys.executable, "scripts/build_feeds.py"], cwd=ROOT,
                       capture_output=True, text=True)
    after = open(MAN).read()
    check(r.returncode == 0, "build_feeds.py runs clean", r.stdout + r.stderr)
    check(before == after,
          "data/feeds.json is up to date with the repository",
          "it regenerated differently — run scripts/build_feeds.py and commit the result")

    d = json.loads(after)
    feeds = d["feeds"]

    print("\nevery feed a page depends on is accounted for")
    check(len(feeds) >= 40, "the manifest is not empty or truncated",
          "only %d feeds" % len(feeds))
    unknown = [f["path"] for f in feeds if f["cadence"] == "unknown"]
    check(not unknown,
          "every feed has a cadence, a writer, or a declaration that a person keeps it",
          "no answer for: " + ", ".join(unknown))
    noone = [f["path"] for f in feeds if not f["pages"]]
    check(not noone, "every feed in the manifest is actually read by a page",
          ", ".join(noone))

    print("\nnothing here is asserted without a reason")
    # A QUIET FEED MUST SAY WHY. "Idle" with no explanation is the same silence
    # this manifest exists to break: a reader cannot tell it from a dead job.
    bad = [f["path"] for f in feeds if f["quiet"] and not f["why_quiet"]]
    check(not bad, "every feed marked quiet carries the reason it is quiet", ", ".join(bad))
    thin = [f["path"] for f in feeds if f["why_quiet"] and len(f["why_quiet"]) < 40]
    check(not thin, "and the reason is a sentence, not a shrug", ", ".join(thin))
    # Derived fields must not be hand-edited into the file.
    check(d.get("generated_by") == "scripts/build_feeds.py",
          "the manifest names the script that writes it")

    print("\nthe status page can actually read the feeds it names")
    status = open(os.path.join(ROOT, "status.html")).read()
    # EVERY tsKey MUST EXIST IN THE FILE IT NAMES. data/cot.json was being read
    # for a key called "fetched"; it carries "updated". That card showed
    # "No timestamp" in amber every day, on the page whose whole job is saying
    # whether a number is current — and nothing anywhere noticed, because a
    # status page reporting on itself is the one thing it cannot do.
    import re as _re
    pairs = _re.findall(r"url:'/([^']+\.json)',\s*tsKey:'([^']+)'", status)
    check(len(pairs) >= 6, "the status page's feed table was found", "%d pairs" % len(pairs))
    bad = []
    for path, key in pairs:
        fp = os.path.join(ROOT, path)
        if not os.path.exists(fp):
            # A data file absent from the CHECKOUT is not a defect in the page.
            # Three times on 2026-09-01 a stale clone nearly produced a false
            # report here; on a runner this is a fresh checkout of main and the
            # file is there. Say which it is rather than failing the build.
            print("        (skipped, not in this checkout: %s)" % path); continue
        try:
            if key not in json.load(open(fp)):
                bad.append("%s has no \"%s\"" % (path, key))
        except Exception as e:
            bad.append("%s (%s)" % (path, type(e).__name__))
    check(not bad, "every timestamp key the status page reads exists in its file",
          "; ".join(bad))

    print("\nthe status page covers what the manifest knows about")
    check("data/feeds.json" in status,
          "status.html reads the manifest rather than a hand-kept list",
          "the page knew about 8 feeds on 2026-09-01 while 45 were in use")

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("feed manifest: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
