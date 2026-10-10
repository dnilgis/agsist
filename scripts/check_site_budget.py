#!/usr/bin/env python3
"""Size budget for what GitHub Pages publishes.

GitHub Pages refuses to deploy a site over 1 GB. Over that line the live site
does not break, it freezes: every price, bid and briefing commit after that
point never reaches agsist.com, and nothing on the page says so.

The way we got close (Oct 2026): a page generator baked the same bulky,
rarely-opened content into thousands of files, and wrote a separate file per
county for something one shared page could have built from data. This check
exists so that cannot happen quietly again. It fails when:

  * the published total passes FAIL_MB (warns at WARN_MB),
  * any top-level folder passes its budget (FOLDER_MB, or DEFAULT_FOLDER_MB),
  * a page inside a generated set (a folder tree with SET_MIN or more .html
    files) is bigger than SET_PAGE_KB. One fat template times 2,800 counties
    is how a folder triples overnight.

Raising a budget is allowed, but it is a decision: change the number here in
the same commit and say why in the message.

  python3 scripts/check_site_budget.py            # report, exit 1 on any fail
  python3 scripts/check_site_budget.py --json     # machine-readable report
  python3 scripts/check_site_budget.py --selftest
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

WARN_MB = 850
FAIL_MB = 900

# Top-level folders, in MB. Set with headroom over what each held on
# 2026-10-10. arc-plc: 150, down from 330 once its pages were slimmed (306 MB
# to 141 MB: math built on open, one shared counter sheet); its build reads this
# number and refuses to write past it.
FOLDER_MB = {
    "data": 300,
    "arc-plc": 150,
    "farmland-atlas": 200,
    "cash-bids": 60,
    "daily": 30,
}
DEFAULT_FOLDER_MB = 25

SET_MIN = 20          # this many .html files under one top-level folder = a generated set
SET_PAGE_KB = 150     # cap for any one page in a generated set

# Known offenders with a dated reason. Each entry is a debt, not a pass:
# remove it when the page is fixed. The check prints them every run.
PAGE_EXCEPTIONS = {
    "basis/kansas.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
    "basis/nebraska.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
    "basis/illinois.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
    "basis/minnesota.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
    "basis/south-dakota.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
    "basis/iowa.html": "basis state pages move the elevator table to on-demand data in the 2026-10 consolidation",
}

SKIP_DIRS = {".git", ".github", "node_modules", "__pycache__", ".claude"}


def walk(root):
    """Yield (relative_path, bytes) for every file Pages would publish.
    The repo has .nojekyll, so Pages serves the tree as-is; dot folders and
    tooling folders above are left out."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            p = os.path.join(dirpath, f)
            try:
                yield os.path.relpath(p, root), os.path.getsize(p)
            except OSError:
                pass


def measure(root=ROOT):
    total = 0
    folders = {}
    html = {}
    for rel, n in walk(root):
        total += n
        top = rel.split(os.sep, 1)[0] if os.sep in rel else "(root files)"
        folders[top] = folders.get(top, 0) + n
        if rel.endswith(".html") and top != "(root files)":
            html.setdefault(top, []).append((rel, n))
    mb = lambda b: round(b / 1048576, 1)
    over = []
    total_mb = mb(total)
    if total > FAIL_MB * 1048576:
        over.append(f"published total {total_mb} MB is over {FAIL_MB} MB (Pages stops deploying at 1 GB)")
    for top, n in folders.items():
        if top == "(root files)":
            continue
        cap = FOLDER_MB.get(top, DEFAULT_FOLDER_MB)
        if n > cap * 1048576:
            over.append(f"{top}/ is {mb(n)} MB, budget {cap} MB")
    fat = []
    excused = []
    for top, pages in html.items():
        if len(pages) < SET_MIN:
            continue
        for rel, n in pages:
            if n > SET_PAGE_KB * 1024:
                if rel.replace(os.sep, "/") in PAGE_EXCEPTIONS:
                    excused.append((rel, round(n / 1024)))
                else:
                    fat.append((rel, round(n / 1024)))
    fat.sort(key=lambda x: -x[1])
    for rel, kb in fat[:10]:
        over.append(f"{rel} is {kb} KB; pages in a generated set are capped at {SET_PAGE_KB} KB")
    if len(fat) > 10:
        over.append(f"...and {len(fat) - 10} more generated pages over {SET_PAGE_KB} KB")
    return {
        "total_mb": total_mb,
        "warn_mb": WARN_MB,
        "fail_mb": FAIL_MB,
        "warn": total > WARN_MB * 1048576,
        "folders": {k: mb(v) for k, v in sorted(folders.items(), key=lambda kv: -kv[1])},
        "over": over,
        "excused": [f"{r} {kb} KB: {PAGE_EXCEPTIONS[r.replace(os.sep, '/')]}" for r, kb in excused],
    }


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    global FAIL_MB, WARN_MB, SET_PAGE_KB, SET_MIN, DEFAULT_FOLDER_MB
    saved = (FAIL_MB, WARN_MB, SET_PAGE_KB, SET_MIN, DEFAULT_FOLDER_MB)
    try:
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "gen"))
            os.makedirs(os.path.join(d, ".git"))
            os.makedirs(os.path.join(d, ".github"))
            for i in range(5):
                with open(os.path.join(d, "gen", f"p{i}.html"), "w") as f:
                    f.write("x" * (3000 if i == 0 else 100))
            with open(os.path.join(d, ".git", "big"), "w") as f:
                f.write("x" * 5_000_000)
            with open(os.path.join(d, "index.html"), "w") as f:
                f.write("x" * 50)
            SET_MIN, SET_PAGE_KB, DEFAULT_FOLDER_MB = 5, 2, 25
            r = measure(d)
            ok(r["total_mb"] < 1, f".git must not count toward the total: {r['total_mb']}")
            ok(any("gen/p0.html" in o for o in r["over"]), f"fat page in a set flagged: {r['over']}")
            ok(not any("p1.html" in o for o in r["over"]), "small pages not flagged")
            SET_MIN = 6
            ok(not any("p0.html" in o for o in measure(d)["over"]), "a folder under SET_MIN is not a set")
            DEFAULT_FOLDER_MB = 0.001
            ok(any(o.startswith("gen/ is") for o in measure(d)["over"]), "folder budget enforced")
            DEFAULT_FOLDER_MB, FAIL_MB = 25, 0
            ok(any("published total" in o for o in measure(d)["over"]), "total budget enforced")
    finally:
        FAIL_MB, WARN_MB, SET_PAGE_KB, SET_MIN, DEFAULT_FOLDER_MB = saved
    for f in fails:
        print("FAIL", f)
    print("site budget selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    r = measure()
    if "--json" in argv:
        print(json.dumps(r, indent=2))
        return 1 if r["over"] else 0
    print(f"published size {r['total_mb']} MB (warn {WARN_MB}, fail {FAIL_MB}, Pages limit 1024)")
    for k, v in list(r["folders"].items())[:8]:
        print(f"  {k:20s}{v:8.1f} MB")
    if r["warn"] and not r["over"]:
        print(f"WARNING: over {WARN_MB} MB")
    for e in r["excused"]:
        print("EXCUSED (fix and remove from PAGE_EXCEPTIONS):", e)
    for o in r["over"]:
        print("OVER:", o)
    return 1 if r["over"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
