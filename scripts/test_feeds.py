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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
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
    check("generated_by" not in d, "the manifest does not name the script that writes it")

    print("\na day-of-month cron reads as monthly (Nov 4, 2026: land-data.yml's '23 9 3 * *' read \"every day\")")
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import build_feeds as BF
    check(BF.cron_sentence(["23 9 3 * *"]) == "1 launch monthly, on day 3 at about 4am Central", "'23 9 3 * *' is monthly, on day 3",
          BF.cron_sentence(["23 9 3 * *"]))
    check(BF.cron_sentence(["0 7 1,15 * *"]).startswith("1 launch monthly, on days 1 and 15"), "a comma list of days")
    check(BF.cron_sentence(["23 9 * * *"]).startswith("1 launch every day"), "a daily cron stays every day")
    lead = [f for f in d["feeds"] if f["path"] == "data/land-sales/lead.json"]
    check(len(lead) == 1 and lead[0]["cadence"].startswith("1 launch monthly"), "the home lead file reads as monthly", lead[0]["cadence"] if lead else "missing")

    print("\nthe status page is retired (Sig, Oct 21): a redirect stub, linked from nowhere")
    # The feed checks above still run on every build; the public page that showed
    # them is gone (it put the plumbing on display). Each page names its own source.
    status = open(os.path.join(ROOT, "status.html")).read()
    check(len(status) < 1536 and 'content="noindex,follow"' in status and 'href="https://agsist.com/"' in status,
          "status.html is the noindex redirect stub to the homepage", "%d bytes" % len(status))
    check("url:'/" not in status, "and it no longer reads any feed")
    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("feed manifest: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
