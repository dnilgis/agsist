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
  * a file named in FILE_KB passes its cap,
  * a page inside a generated set (a folder tree with SET_MIN or more .html
    files) is bigger than SET_PAGE_KB. One fat template times 2,800 counties
    is how a folder triples overnight.

Raising a budget is allowed, but it is a decision: change the number here in
the same commit and say why in the message.

  python3 scripts/check_site_budget.py            # report, exit 1 on any fail
  python3 scripts/check_site_budget.py --json     # machine-readable report
  python3 scripts/check_site_budget.py --selftest
  python3 scripts/check_site_budget.py --tree origin/main   # measure a commit, not the working tree

How it counts: every file in the checkout (or, with --tree, every blob in that
commit's tree) except .git, dot folders, the tooling folders in SKIP_DIRS and
files git ignores, at its size on disk in bytes; 1 MB = 1,048,576 bytes. A sparse
or partial checkout holds only part of the tree, so the walk would undercount
(Oct 27: a sparse worktree read 25.9 MB of 817); there it measures HEAD's tree
instead and says so.

NOT_READER_FACING lists what Pages serves today that no reader loads (tooling,
tests, fixtures, workflow-only data). It counts toward the total because Pages
publishes it; the report prints it so a publish-only-the-site deploy can be
weighed (notes/panels/godseye-2026-10-26/size-trim-plan.md in feedbag).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# WARN_MB prints a warning (and a ::warning:: annotation in the site-budget
# workflow) so the 900 MB stop is never a surprise; FAIL_MB fails the check.
# Pages' own hard stop is 1024 MB.
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
    # prf: 75 (2026-10-13). 48 state pages (1.6 MB) plus 3,070 county pages
    # from scripts/build_prf_counties.py at about 20 KB each (61 MB): the grids,
    # values, a month table, five recent years and the grid list, nothing more;
    # the year-by-year record stays in the calculator. No static header or
    # footer copy in the county pages.
    "prf": 75,
    # rain: 60 (2026-10-13). One page per county with a NOAA station that
    # reported 90% of the year (at most 3,141) from scripts/build_county_rain.py
    # at about 16 KB each (the answer, a small chart, the month table, FAQ;
    # shared stylesheet, no static header or footer copy): about 50 MB if every
    # county qualified, plus about 50 state pages. Data stays in data/rain/,
    # one file per state, about 1.5 KB a county.
    "rain": 60,
}
DEFAULT_FOLDER_MB = 25

# Single files that grow by appending, in KB. A history file that grows a row
# a day is fine for years; one that grows without a cap is how a folder fills.
# fertilizer-coops-history: 1024 (2026-10-15). scripts/fetch_coop_fert.py
# appends a row only when a co-op's price or date changes (about 60 bytes a
# row) and stops appending at its own HIST_MAX_KB, the same number.
FILE_KB = {
    "data/fertilizer-coops-history.json": 1024,
}

SET_MIN = 20          # this many .html files under one top-level folder = a generated set
SET_PAGE_KB = 150     # cap for any one page in a generated set

# Known offenders with a dated reason. Each entry is a debt, not a pass:
# remove it when the page is fixed. The check prints them every run.
PAGE_EXCEPTIONS = {
}

SKIP_DIRS = {".git", ".github", "node_modules", "__pycache__", ".claude"}

# Published today but not loaded by any reader (measured Oct 27, 2026 from
# origin/main: no page, component or worker references them). A prefix ending
# in "/" is a folder; anything else is one file. scripts/pages_publish.py leaves
# these out of a filtered Pages artifact.
NOT_READER_FACING = (
    "scripts/", "test/", "build/", "references/", "workers/",
    "CLAUDE.md", "TODO-SIG.md", ".gitignore",
    # workflow inputs and outputs read only by scripts/ (Oct 27 grep of every
    # page, component and worker)
    "data/prf-stories/", "data/atlas-stories/", "data/cash-bids-stories/",
    "data/wasde-pdf/", "data/site-inventory.json", "data/rain-print-examples/",
    "data/elevator-directory.json",
    "data/ids/geo-crosswalk.json",   # read by scripts/join_report.py and builds only (Oct 27)
    "data/ids/board-parents.json",   # read by scripts/build_cash_bid_pages.py only (Oct 27, fx/bidkeys)
)


def reader_facing(rel):
    """False for a path in NOT_READER_FACING (rel uses / or os.sep)."""
    rel = rel.replace(os.sep, "/")
    for p in NOT_READER_FACING:
        if (p.endswith("/") and rel.startswith(p)) or rel == p:
            return False
    return True


def is_sparse(root):
    """True when root is a git checkout that holds only part of its tree."""
    import subprocess
    try:
        out = subprocess.run(["git", "-C", root, "config", "--bool", "core.sparseCheckout"],
                             capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    return out.stdout.decode().strip() == "true"


def walk_tree(root, rev):
    """Yield (relative_path, bytes) for every blob in rev's tree that Pages would
    publish, by the same rules as walk(). Reads git objects, so it works in a
    sparse or blobless checkout. Raises RuntimeError when git cannot list rev."""
    import subprocess
    out = subprocess.run(["git", "-C", root, "ls-tree", "-r", "-l", "-z", rev],
                         capture_output=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError(f"git ls-tree {rev} failed: {out.stderr.decode('utf-8', 'replace').strip()}")
    for rec in out.stdout.decode("utf-8", "replace").split("\0"):
        if not rec or "\t" not in rec:
            continue
        meta, path = rec.split("\t", 1)
        m = meta.split()
        if len(m) < 4 or m[1] != "blob" or m[3] == "-":
            continue
        parts = path.split("/")
        if any(d in SKIP_DIRS or d.startswith(".") for d in parts[:-1]):
            continue
        yield os.path.normpath(path), int(m[3])


def ignored_files(root):
    """Files git ignores in this checkout. They are never committed, so Pages never
    publishes them: raw inputs unpacked from the raw branch for a local build
    (bash scripts/pull_raw.sh data/fsa) must not count. Empty when root is not a
    git checkout."""
    import subprocess
    try:
        out = subprocess.run(["git", "-C", root, "ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
                             capture_output=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return set()
    if out.returncode != 0:
        return set()
    return {os.path.normpath(p) for p in out.stdout.decode("utf-8", "replace").split("\0") if p}


def walk(root):
    """Yield (relative_path, bytes) for every file Pages would publish.
    The repo has .nojekyll, so Pages serves the tree as-is; dot folders and
    tooling folders above are left out, and so are files git ignores."""
    skip = ignored_files(root)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            p = os.path.join(dirpath, f)
            if skip and os.path.relpath(p, root) in skip:
                continue
            try:
                yield os.path.relpath(p, root), os.path.getsize(p)
            except OSError:
                pass


def measure(root=ROOT, rev=None):
    source = "working tree"
    if rev is None and is_sparse(root):
        rev = "HEAD"
        source = "git tree HEAD (sparse checkout: the working tree holds only part of the site)"
    elif rev is not None:
        source = f"git tree {rev}"
    files = walk(root) if rev is None else walk_tree(root, rev)
    total = 0
    not_reader = 0
    sizes = {}
    folders = {}
    html = {}
    for rel, n in files:
        total += n
        if rel.replace(os.sep, "/") in FILE_KB:
            sizes[rel.replace(os.sep, "/")] = n
        if not reader_facing(rel):
            not_reader += n
        top = rel.split(os.sep, 1)[0] if os.sep in rel else "(root files)"
        folders[top] = folders.get(top, 0) + n
        if rel.endswith(".html") and top != "(root files)":
            html.setdefault(top, []).append((rel, n))
    mb = lambda b: round(b / 1048576, 1)
    over = []
    total_mb = mb(total)
    if total > FAIL_MB * 1048576:
        over.append(f"published total {total_mb} MB is over {FAIL_MB} MB (Pages stops deploying at 1 GB)")
    warn = total > WARN_MB * 1048576
    for top, n in folders.items():
        if top == "(root files)":
            continue
        cap = FOLDER_MB.get(top, DEFAULT_FOLDER_MB)
        if n > cap * 1048576:
            over.append(f"{top}/ is {mb(n)} MB, budget {cap} MB")
    for rel, cap in FILE_KB.items():
        n = sizes.get(rel)
        if n is not None and n > cap * 1024:
            over.append(f"{rel} is {round(n / 1024)} KB, cap {cap} KB")
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
        "warn": warn,
        "headroom_mb": round(FAIL_MB - total / 1048576, 1),
        "not_reader_facing_mb": mb(not_reader),
        "source": source,
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
            FAIL_MB = saved[0]
            # the warning band: over WARN_MB warns without failing, under it is quiet
            WARN_MB = 0
            r = measure(d)
            ok(r["warn"] and not any("published total" in o for o in r["over"]),
               f"over WARN_MB warns, does not fail: {r['warn']} {r['over']}")
            WARN_MB = 1
            ok(not measure(d)["warn"], "under WARN_MB no warning")
            WARN_MB = saved[1]
            r = measure(d)
            ok(abs(r["headroom_mb"] - (FAIL_MB - r["total_mb"])) < 0.2,
               f"headroom is FAIL_MB minus the total: {r['headroom_mb']}")
            with open(os.path.join(d, "gen", "hist.json"), "w") as f:
                f.write("x" * 3000)
            FILE_KB["gen/hist.json"] = 2
            ok(any(o.startswith("gen/hist.json is") for o in measure(d)["over"]), "file cap enforced")
            FILE_KB["gen/hist.json"] = 4
            ok(not any("hist.json" in o for o in measure(d)["over"]), "file under its cap passes")
        with tempfile.TemporaryDirectory() as d:
            import subprocess
            os.makedirs(os.path.join(d, "data", "raw"))
            with open(os.path.join(d, ".gitignore"), "w") as f:
                f.write("/data/raw/*\n")
            with open(os.path.join(d, "data", "raw", "big.xlsx"), "w") as f:
                f.write("x" * 3_000_000)
            with open(os.path.join(d, "data", "kept.json"), "w") as f:
                f.write("x" * 1_100_000)
            if subprocess.run(["git", "init", "-q", d], capture_output=True).returncode == 0:
                r = measure(d)
                ok(r["folders"].get("data") == 1.0, f"an ignored raw file unpacked for a local build does not count: {r['folders']}")
                # the tree of a commit measures the same as its full checkout, and a
                # sparse checkout of it is measured from that tree, not undercounted
                os.makedirs(os.path.join(d, "scripts"))
                with open(os.path.join(d, "scripts", "tool.py"), "w") as f:
                    f.write("x" * 524_288)
                os.makedirs(os.path.join(d, ".github"))
                with open(os.path.join(d, ".github", "w.yml"), "w") as f:
                    f.write("x" * 2_000_000)
                g = ["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t"]
                subprocess.run(g + ["add", "-A"], capture_output=True)
                if subprocess.run(g + ["commit", "-q", "-m", "t"], capture_output=True).returncode == 0:
                    full = measure(d)
                    tree = measure(d, rev="HEAD")
                    ok(tree["total_mb"] == full["total_mb"] == 1.5,
                       f"tree and checkout agree, .github and ignored files left out: {tree['total_mb']} {full['total_mb']}")
                    ok(tree["not_reader_facing_mb"] == 0.5, f"scripts/ counts as not reader-facing: {tree['not_reader_facing_mb']}")
                    subprocess.run(g + ["sparse-checkout", "set", "--no-cone", "/scripts/"], capture_output=True)
                    if is_sparse(d):
                        sp = measure(d)
                        ok(sp["total_mb"] == 1.5 and "sparse" in sp["source"],
                           f"a sparse checkout is measured from its tree: {sp['total_mb']} {sp['source']}")
                    else:
                        fails.append("sparse checkout could not be set up in the selftest")
                    try:
                        measure(d, rev="no-such-rev")
                        fails.append("a bad --tree commit must raise, not read as 0 MB")
                    except RuntimeError:
                        pass
    finally:
        FAIL_MB, WARN_MB, SET_PAGE_KB, SET_MIN, DEFAULT_FOLDER_MB = saved
        FILE_KB.pop("gen/hist.json", None)
    ok(not reader_facing("scripts/x.py") and not reader_facing("CLAUDE.md")
       and not reader_facing("data/prf-stories/a.json") and reader_facing("data/prf/a.json")
       and reader_facing("rain/iowa/story-county.html") and reader_facing("test.html"),
       "NOT_READER_FACING matches folders by prefix and files exactly")
    for f in fails:
        print("FAIL", f)
    print("site budget selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    if "--selftest" in argv:
        return selftest()
    rev = None
    if "--tree" in argv:
        i = argv.index("--tree")
        if i + 1 >= len(argv):
            print("--tree needs a commit, e.g. --tree origin/main")
            return 2
        rev = argv[i + 1]
    try:
        r = measure(rev=rev)
    except RuntimeError as e:
        print("FAIL:", e)
        return 2
    if "--json" in argv:
        print(json.dumps(r, indent=2))
        return 1 if r["over"] else 0
    print(f"published size {r['total_mb']} MB (warn {WARN_MB}, fail {FAIL_MB}, Pages limit 1024), measured from the {r['source']}")
    for k, v in list(r["folders"].items())[:8]:
        print(f"  {k:20s}{v:8.1f} MB")
    print(f"not loaded by readers (NOT_READER_FACING): {r['not_reader_facing_mb']} MB; headroom to the {FAIL_MB} MB stop: {r['headroom_mb']} MB")
    if r["warn"] and not r["over"]:
        print(f"WARNING: published size {r['total_mb']} MB is over {WARN_MB} MB; the check fails at {FAIL_MB} MB ({r['headroom_mb']} MB left)")
    for e in r["excused"]:
        print("EXCUSED (fix and remove from PAGE_EXCEPTIONS):", e)
    for o in r["over"]:
        print("OVER:", o)
    return 1 if r["over"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
