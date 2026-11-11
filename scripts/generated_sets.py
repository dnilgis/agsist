#!/usr/bin/env python3
"""generated_sets.py: the one table of generated page sets, and the three things that use it (Nov 4, 2026).

WHY. On Nov 3 four pull requests carried generated page sets (#280 the rain set, #282 the cash bid town pages
twice, #296 land sales). Main's own jobs rebuild those sets every 15 minutes to once a day, so a pull request's
copy went stale within hours: merge conflicts, or a merge on checks run against an older main and main red
(build_*.py --check). build rule 49 and 60 asked the lead to remember; this makes it mechanical.

THE TABLE (SETS below): for each set, the builder commands, the output paths, the --check, the workflow that
rebuilds it on main, whether the builder reads only committed files (offline), and the code it runs (the builder,
every scripts/*.py it imports, and the extra files listed). NOT_SETS names every other folder of 20 or more pages,
and every --check in scripts/dev/checks.sh that is not a set's, with the reason. test/generated-sets.test.mjs holds
the table to the repository (every folder, every --check, every path exists).

THE RULES IT ENFORCES
  guard      (pr-checks.yml, guard job, pull requests) a pull request that changes a set's output paths fails:
             generated pages are built on main; change the builder and its fixture tests only. Two ways past:
             the pull request comes from the data bot, or the lead adds the label regen-ok (rare: a set with no
             main job, or a one-time repair).
  prebuild   (scripts/dev/checks.sh with AGSIST_GEN_BASE, the PR checks) a pull request that changes an offline
             set's code gets that set rebuilt in the CI copy before the checks, the same way the built files are
             (AGSIST_PREBUILD), so the --check and the tests see what main will serve after the rebuild. Each
             rebuilt set's dependents (the summary files below, and any summary that reads those) are rebuilt
             right after, in SUMMARIES order. Nothing is committed. A network set (cash bid pages) is not
             rebuilt here, nor are its dependents: its tests run on fixtures.
  main       (main-checks.yml, the generated job, before the suite) a set whose code changed on main in the last
             WINDOW_MIN minutes is rebuilt at once: an offline set here, from main as it is, and committed; a
             network set by starting its own workflow by hand and waiting for that run. A set whose code did not
             change is left alone, so a stale set from a failing data job still shows red.

  dependents (build rule 61, Nov 4: a hand run of cash-bid-index.yml left llms.txt on the partial
             edition and main went red) every summary file that reads a set's output (SUMMARIES: llms.txt,
             the search index, data/feeds.json, ...) is that set's dependent, and is rebuilt in the same
             commit as the set: by the set's own workflow (`dependents <id> --stage` right before its commit)
             and by `main` here. test/generated-sets.test.mjs traces what each summary builder really reads
             (scripts/trace_reads.py) and fails when a set it reads does not list it, or a set's workflow
             does not run the call.

    python3 scripts/generated_sets.py table                 print the table
    python3 scripts/generated_sets.py json                  the table as JSON (the inventory test reads it)
    python3 scripts/generated_sets.py guard --base HEAD^1   pr-checks guard (pull request event; --root DIR
                                                            diffs another checkout, for the tests)
    python3 scripts/generated_sets.py prebuild --base HEAD^1
    python3 scripts/generated_sets.py main --window 360 [--dry-run]
    python3 scripts/generated_sets.py dependents rain [prf ...] [--stage] [--dry-run] [--files]
                                                            rebuild the sets' summary files (and git add them)
    python3 scripts/generated_sets.py pull-rebase rain [--autostash] [--branch main]
                                                            git pull --rebase; a conflict only in summary files
                                                            is rebuilt, never resolved to either side
    python3 scripts/generated_sets.py trace llms            the sets a summary builder reads (JSON)
    python3 scripts/generated_sets.py --selftest
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WINDOW_MIN = 360            # a set whose code changed on main this recently is rebuilt by main-checks
WAIT_MIN = 30               # how long main-checks waits for a network set's own run
LABEL = "regen-ok"
DATA_BOTS = {"github-actions[bot]"}
API = "https://api.github.com"

PY = "python3"
# Order matters on main: the town pages first (the rain and Atlas pages link the towns that have a page),
# then the sets in the order their own jobs run them.
SETS = [
    {"id": "cash-bids", "offline": False, "workflow": "cash-bid-pages.yml", "dispatch": {"force": "true"},
     "build_job": "build",
     "build": [[PY, "scripts/build_cash_bid_pages.py"]], "check": None,
     "outputs": ["cash-bids/**", "sitemap-cash-bids.xml"],
     "writes": [], "code": ["scripts/build_cash_bid_pages.py"], "inputs": [],
     "dependents": ["search", "llms"]},
    {"id": "prf", "offline": True, "workflow": "prf.yml",
     "build": [["node", "scripts/prf_facts.mjs"], [PY, "scripts/build_prf_states.py"], [PY, "scripts/build_prf_counties.py"]],
     "check": [[PY, "scripts/build_prf_states.py", "--check"], [PY, "scripts/build_prf_counties.py", "--check"]],
     "outputs": ["prf/**", "sitemap-prf.xml"],
     "writes": ["data/prf/facts.json", "data/pointers"],
     "code": ["scripts/build_prf_states.py", "scripts/build_prf_counties.py", "scripts/prf_facts.mjs",
              "scripts/prf_county_facts.mjs", "components/prf-math.js"], "inputs": [],
     "dependents": ["stamp-prf", "feeds", "llms"]},
    {"id": "arc-plc", "offline": True, "workflow": "arc-plc-refresh.yml", "raw": ["data/fsa"],
     "build": [[PY, "scripts/build_arc_plc.py"]], "check": [[PY, "scripts/build_arc_plc.py", "--check"]],
     "outputs": ["arc-plc/**", "sitemap-arc-plc.xml"],
     "writes": ["data/arc-plc", "arc-plc.html", "data/arc-plc.json", "components/arc-plc-form.js", "embed/arc-plc.html", "llms.txt",
                "data/pointers"],
     "code": ["scripts/build_arc_plc.py"], "inputs": [],
     "dependents": ["breakeven", "search", "feeds", "llms"]},
    {"id": "land-sales", "offline": True, "workflow": "land-data.yml",
     "build": [[PY, "scripts/build_land_sales.py"]], "check": [[PY, "scripts/build_land_sales.py", "--check"]],
     "outputs": ["land-sales/**", "sitemap-land-sales.xml"],
     "writes": ["data/land-sales", "data/land/names"],
     "code": ["scripts/build_land_sales.py"],
     # kept by hand (build_land_sales.py: the coverage table, the removed-name list)
     "inputs": ["data/land-sales/coverage.json", "data/land-sales/removed.json"],
     "dependents": ["search", "feeds", "llms"]},
    {"id": "rain", "offline": True, "workflow": "county-rain.yml",
     "build": [[PY, "scripts/build_county_rain.py"]], "check": [[PY, "scripts/build_county_rain.py", "--check"]],
     "outputs": ["rain/**", "sitemap-rain.xml"],
     "writes": ["rain.html", "data/pointers"],
     # the radar and drought tabs of /rain (Nov 11, 2026): panel files the builder reads into rain.html
     "code": ["scripts/build_county_rain.py", "components/fold/radar.html", "components/fold/radar.css",
              "components/fold/drought.html"], "inputs": [],
     "dependents": ["feeds", "llms"]},
    {"id": "farmland-atlas", "offline": True, "workflow": "farmland-atlas-pages.yml",
     "build": [[PY, "scripts/build_atlas_pages.py"]], "check": None,
     # compare, methods, sheet and qr.js are written by hand; the share cards (farmland-atlas/og) live in
     # dnilgis/agsist-data since Nov 4, 2026 (scripts/share_host.py), drawn by farmland-atlas-pages.yml;
     # a card committed here again would count as this set's output (and share_host.py check fails on it)
     "outputs": ["farmland-atlas/**", "!farmland-atlas/compare.html",
                 "!farmland-atlas/methods.html", "!farmland-atlas/sheet.html", "!farmland-atlas/qr.js", "sitemap-atlas.xml"],
     # data/share-host.json: where the share cards are served (scripts/share_host.py; the seed job writes it)
     # the county pages load county-home.js and county-print.js at their own hash (?v=), so a change to either is a rebuild
     "writes": ["data/pointers"], "code": ["scripts/build_atlas_pages.py", "components/county-home.js", "components/county-print.js"],
     "inputs": ["data/share-host.json", "data/land-sales/coverage.json"],
     "dependents": ["search", "llms"]},
    {"id": "rent", "offline": True, "workflow": "state-rent-pages.yml",
     "build": [[PY, "scripts/build_state_rent_pages.py"]], "check": None,
     "outputs": ["rent/**"], "writes": [], "code": ["scripts/build_state_rent_pages.py"], "inputs": [],
     "dependents": ["search", "llms"]},
    {"id": "yield", "offline": True, "workflow": "yield-pages.yml",
     "build": [[PY, "scripts/build_state_yield_pages.py"]], "check": None,
     "outputs": ["yield/**"], "writes": [], "code": ["scripts/build_state_yield_pages.py"], "inputs": [],
     "dependents": ["search", "llms"]},
    {"id": "hail", "offline": True, "workflow": "mesh.yml",
     "build": [[PY, "scripts/generate_hail_events.py"]], "check": None,
     "outputs": ["hail/**"], "writes": ["hail-map.html", "sitemap.xml", "data/hail/storm-days.json"],
     "code": ["scripts/generate_hail_events.py"], "inputs": [],
     "dependents": ["feeds", "llms"]},
    {"id": "hail-map", "offline": True, "workflow": "hail-states.yml",
     "build": [[PY, "scripts/generate_hail_states.py"]], "check": None,
     "outputs": ["hail-map/**"], "writes": ["sitemap.xml"],
     # the state pages copy the ?v= the map page carries for its scripts
     "code": ["scripts/generate_hail_states.py"], "inputs": ["hail-map.html"],
     "dependents": ["search", "llms"]},
    # the Cash Bid Index (build rule 61): the month's edition is written by cash-bid-index.yml (--build, from the
    # boards folded into data/cash-index by fetch_bids.yml); the page is rebuilt from editions.json alone (--page)
    {"id": "cash-bid-index", "offline": True, "workflow": "cash-bid-index.yml",
     "build": [[PY, "scripts/cash_bid_index.py", "--page"]], "check": [[PY, "scripts/cash_bid_index.py", "--check"]],
     "outputs": ["cash-bid-index.html"], "writes": ["data/cash-index/editions.json"],
     # its page copies the site menu, fonts and early scripts from grain-emc.html (cash_bid_index._nav_blocks)
     "code": ["scripts/cash_bid_index.py"], "inputs": ["grain-emc.html"],
     "dependents": ["feeds", "llms"]},
    # the Infographic of the Week (Nov 7, 2026): one page per spec in data/infographics/ (scripts/build_infographic.py
    # writes the specs from our data files), the archive and one link card per page; infographic.css is written by hand
    {"id": "infographic", "offline": True, "workflow": "infographic-pages.yml",
     "build": [[PY, "scripts/build_infographic_pages.py"]], "check": None,
     "outputs": ["infographic/**", "!infographic/infographic.css"],
     "writes": [], "code": ["scripts/build_infographic_pages.py"], "inputs": [],
     "dependents": []},
]

# Summary files: committed files whose builder reads what a set writes (build rule 61). A set lists the ones it
# feeds as its "dependents"; they are rebuilt, in this order, in the same commit as the set. "trace" is a run of
# the builder that writes nothing (its --check, or the build itself when it writes only when its output changes),
# which scripts/trace_reads.py watches to learn what it reads. "files" is what the rebuild commits. A summary that
# reads another summary's files lists it under "dependents" (optional) and comes after it here.
SUMMARIES = [
    {"id": "stamp-prf", "build": [PY, "scripts/stamp_prf.py"], "trace": ["--check"], "files": ["prf.html"]},
    {"id": "breakeven", "build": [PY, "scripts/build_breakeven_data.py"], "trace": ["--check"], "files": ["data/breakeven"]},
    {"id": "search", "build": [PY, "scripts/build_search_index.py"], "trace": ["--check"],
     "files": ["data/search-index.json", "data/search-elevators.json", "data/search-places.json"]},
    {"id": "feeds", "build": [PY, "scripts/build_feeds.py"], "trace": [], "files": ["data/feeds.json"]},
    {"id": "llms", "build": [PY, "scripts/build_llms_txt.py"], "trace": ["--check"], "files": ["llms.txt"]},
]
# Builders that read many files but are not a set's summary, and why (the inventory test holds every --check in
# scripts/dev/checks.sh to SETS, SUMMARIES or one of these lists).
NOT_SUMMARIES = {
    "build_place_pct": "reads the Atlas data (data/atlas) and the fetched rain files, no file a set's builder writes",
    "inject_static_nav": "writes the shared menu into pages; it reads the menu (components/), not a set's output",
    "build_share_images": "checks the share images each page names; the images are drawn by their own jobs",
    "build_croptour": "bakes one hand-written page (crop-tour.html) from its own data",
    "build_farmbill": "bakes one hand-written page (farm-bill.html) from its own data",
    "usda_corrections": "a log of USDA's own corrections, fetched; no set's output",
    "build_basis_join": "joins the fetched bids and basis files, which no set's builder writes",
    "build_geo_crosswalk": "a county and town crosswalk from Census files, no set's output",
    "company_ids": "checks data/ids/companies.json, built from the bids repo's board files on the bids run; no set's output",
    "build_whats_new": "built from the entry files in data/whats-new on main (scripts/dev/main_build.py); it reads a "
                       "page only to check an entry's link is there",
    "generate_rss": "feed.xml, from the Daily's archive (data/daily-archive), which no set writes",
    "update_sitemap": "sitemap.xml lastmod, bumped from git by sitemap.yml; each set writes its own sitemap-<set>.xml "
                      "(an output, so always current with the set) and adds its pages to sitemap.xml itself",
}
TRACE_TIMEOUT = 900


# Folders of SET_MIN or more pages (scripts/check_site_budget.py) that are not a set here, and why.
NOT_SETS = {
    "daily": "the Daily's own archive: one page per issue written by the send (daily.yml), never rebuilt from a builder",
    "basis": "forwarding stubs to /cash-bids/<state>/ since Oct 10, 2026, written once (build_state_basis_pages.py)",
    "test": "test fixtures, not published pages",
}
# --check lines in scripts/dev/checks.sh that are not a set's check, and why.
NOT_SET_CHECKS = {
    "build_breakeven_data": "a data file (data/breakeven), no page set",
    "stamp_prf": "stamps one hand-written page (prf.html), which pull requests edit",
    "build_croptour": "bakes one hand-written page (crop-tour.html)",
    "build_farmbill": "bakes one hand-written page (farm-bill.html)",
}


GIT_ROOT = ROOT             # where the git commands run (--root: a fixture repository in the tests)


def sh(cmd, check=False, **kw):
    return subprocess.run(cmd, cwd=GIT_ROOT, capture_output=True, text=True, check=check, **kw)


# ── paths ──────────────────────────────────────────────────────────────────────
def _pat(p):
    """a GitHub-style glob: ** spans folders, * stays in one"""
    out, i = "", 0
    while i < len(p):
        if p.startswith("**", i):
            out += ".*"
            i += 2
        elif p[i] == "*":
            out += "[^/]*"
            i += 1
        else:
            out += re.escape(p[i])
            i += 1
    return re.compile(out + r"\Z")


def matches(pats, path):
    """the last pattern that matches decides; '!' patterns exclude"""
    hit = False
    for p in pats:
        neg = p.startswith("!")
        if _pat(p[1:] if neg else p).match(path):
            hit = not neg
    return hit


SHARED_WRITES = {"data/pointers"}   # written by many builders and jobs: staged on main, never guarded


def guarded_writes(s):
    """the data files a set's builder writes besides its pages (data/arc-plc, data/land-sales, ...): guarded
    like the pages. Shared files a builder also rewrites (hub pages, sitemap.xml, llms.txt) are edited by hand
    too, so they are staged on main but not guarded."""
    return [w for w in s["writes"] if w.startswith("data/") and w not in SHARED_WRITES]


def _under(path, w):
    return path == w or path.startswith(w.rstrip("/") + "/")


def owner(path, sets=SETS):
    """the set whose outputs (pages, and the data files it writes) hold this path, or None. A hand-kept
    input (data/land-sales/coverage.json) is never an output."""
    for s in sets:
        if path in s["inputs"]:
            continue
        if matches(s["outputs"], path) or any(_under(path, w) for w in guarded_writes(s)):
            return s["id"]
    return None


def relevant(pr_files, sets=SETS, root=ROOT):
    """-> a test path -> bool: the files whose change on main can change this pull request's checks: the
    files it changes, and every output and write of a set whose code it changes (its prebuild and the
    tests read those)."""
    mine = set(pr_files)
    hit = [s for s in sets if s["id"] in touched(sets, pr_files, root)]

    def test(path):
        return path in mine or any(matches(s["outputs"], path) or any(_under(path, w) for w in s["writes"]) for s in hit)
    return test


NAV_FILES = ("components/header-fallback.html", "components/footer-fallback.html")   # what inject_static_nav bakes in
_IMP = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))", re.M)


def py_closure(script, root=ROOT):
    """the script and every scripts/*.py it imports, at any depth"""
    seen, todo = set(), [os.path.splitext(os.path.basename(script))[0]]
    while todo:
        n = todo.pop()
        f = os.path.join(root, "scripts", n + ".py")
        if n in seen or not os.path.isfile(f):
            continue
        seen.add(n)
        for m in _IMP.finditer(open(f, encoding="utf-8").read()):
            names = [m.group(1)] if m.group(1) else [x.strip().split(" ")[0] for x in m.group(2).split(",")]
            todo += [x.split(".")[0] for x in names if x]
    return sorted("scripts/%s.py" % n for n in seen)


def code_paths(s, root=ROOT):
    """every file whose change can change what the set's builder writes (as far as this table knows)"""
    out = set(s["inputs"])
    for c in s["code"]:
        out.update(py_closure(c, root) if c.endswith(".py") else [c])
    # a builder that bakes the site menu through inject_static_nav writes whatever the menu files say (Nov 4, 2026:
    # the Farmland sales menu left the PRF state pages stale in PR 322's checks, which rebuilt only sets whose
    # own code changed)
    if "scripts/inject_static_nav.py" in out:
        out.update(NAV_FILES)
    return sorted(out)


def touched(sets, files, root=ROOT):
    """ids of the sets whose code or hand-kept inputs are among these files"""
    files = set(files)
    return [s["id"] for s in sets if files & set(code_paths(s, root))]


# ── the guard ──────────────────────────────────────────────────────────────────
def guard(files, author="", labels=(), sets=SETS):
    """-> (ok, message). files: what the pull request changes."""
    hits = {}
    for f in files:
        o = owner(f, sets)
        if o:
            hits.setdefault(o, []).append(f)
    if not hits:
        return True, "no generated page set is changed by hand"
    if author in DATA_BOTS:
        return True, "generated pages changed by the data bot (%s): allowed" % author
    if LABEL in set(labels):
        return True, "generated pages changed, label %s set by the lead: allowed (%s)" % (LABEL, ", ".join(sorted(hits)))
    by = {s["id"]: s for s in sets}
    lines = ["generated pages are built on main; change the builder and its fixture tests only.",
             "This pull request changes the output of %d generated set(s):" % len(hits)]
    for sid in sorted(hits):
        s = by[sid]
        fs = sorted(hits[sid])
        lines.append("  %s: %d file(s), e.g. %s (builder: %s; rebuilt on main by %s)" % (
            sid, len(fs), ", ".join(fs[:3]), " && ".join(" ".join(c) for c in s["build"]), s["workflow"]))
    lines.append("Drop them from the branch: git checkout origin/main -- <those paths> (or git rm the new ones), "
                 "commit, push. The PR checks rebuild an offline set in their own copy when its builder changes, "
                 "and main rebuilds it after the merge (main-checks.yml).")
    lines.append("Only the lead may let this through, with the label %s (a set with no main job, or a one-time repair); "
                 "after adding it, re-run this guard job (it reads the labels as they are then)." % LABEL)
    return False, "\n".join(lines)


def changed_files(base):
    r = sh(["git", "diff", "--name-only", "--no-renames", base, "HEAD"])
    if r.returncode != 0:
        raise SystemExit("generated_sets.py: cannot diff %s..HEAD: %s" % (base, r.stderr.strip()[:200]))
    return [l for l in r.stdout.splitlines() if l]


def gh_get(path, token):
    req = urllib.request.Request(API + path)
    req.add_header("Accept", "application/vnd.github+json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"null")


def cmd_guard(base):
    ev = {}
    p = os.environ.get("GITHUB_EVENT_PATH")
    if p and os.path.isfile(p):
        ev = json.load(open(p, encoding="utf-8"))
    pr = ev.get("pull_request") or {}
    author = (pr.get("user") or {}).get("login", "")
    labels = [l.get("name") for l in pr.get("labels") or []]
    # the label as it is now (a re-run keeps the payload of the push that started it); the payload's when the
    # API does not answer
    repo, n = os.environ.get("GITHUB_REPOSITORY"), pr.get("number")
    if repo and n:
        try:
            labels = [l.get("name") for l in gh_get("/repos/%s/issues/%d/labels" % (repo, n), os.environ.get("GH_TOKEN")) or []]
        except (urllib.error.URLError, OSError, ValueError) as e:
            print("labels from the event (the API did not answer: %s)" % str(e)[:80])
    ok, msg = guard(changed_files(base), author, labels)
    print(msg)
    if not ok and os.environ.get("GITHUB_ACTIONS"):
        print("::error title=generated pages are built on main::" + msg.splitlines()[1])
    return 0 if ok else 1


# ── building ───────────────────────────────────────────────────────────────────
def build(s):
    for c in s["build"]:
        t = time.time()
        r = subprocess.run(c, cwd=ROOT, capture_output=True, text=True)
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        print("  %s: rc=%d %.0fs %s" % (" ".join(c), r.returncode, time.time() - t, tail[0][:160]))
        if r.returncode != 0:
            print((r.stdout + r.stderr)[-3000:])
            return False
    return True


def pull_raw(s):
    """the raw-branch files a builder reads (scripts/pull_raw.sh), unless this copy has them already"""
    for r in s.get("raw", []):
        d = os.path.join(ROOT, r)
        if not (os.path.isdir(d) and any(f.startswith("arcco_") for f in os.listdir(d))):
            print("  %s: %s" % (r, "pulled" if sh(["bash", "scripts/pull_raw.sh", r]).returncode == 0 else "pull failed"))


def cmd_prebuild(base):
    """the PR checks: rebuild, in this copy only, every offline set whose code the pull request changes"""
    files = changed_files(base)
    ids = touched(SETS, files, ROOT)
    if not ids:
        print("prebuild: no generated set's code changed against %s" % base)
        return 0
    bad, rebuilt = 0, []
    for s in SETS:
        if s["id"] not in ids:
            continue
        if not s["offline"]:
            print("prebuild: %s reads the live network; not rebuilt here (its tests run on fixtures; main rebuilds it "
                  "after the merge with %s)" % (s["id"], s["workflow"]))
            continue
        print("prebuild: %s (its code changed)" % s["id"])
        pull_raw(s)
        if build(s):
            rebuilt.append(s["id"])
        else:
            bad += 1
    # the summary files the rebuilt sets feed (and the summaries those feed), in SUMMARIES order, before any
    # check reads them (Nov 10, 2026: a change to a module every set imports rebuilt arc-plc here but not
    # data/breakeven, which reads it, so build_breakeven_data.py --check read 47 files stale)
    deps = summary_closure({d for sid in rebuilt for d in next(s for s in SETS if s["id"] == sid)["dependents"]})
    if deps:
        print("prebuild: dependents of %s: %s" % (", ".join(rebuilt), ", ".join(deps)))
        failed = run_dependents(deps)
        if failed:
            print("prebuild: dependent(s) not rebuilt: %s" % ", ".join(failed))
            bad += len(failed)
    return 1 if bad else 0


# ── main ───────────────────────────────────────────────────────────────────────
def recent_changes(window_min, now=None):
    """[(unix time, [files])] of main's commits in the window (fetches that much history into a shallow clone)"""
    now = now or datetime.now(timezone.utc)
    since = (now - timedelta(minutes=window_min)).strftime("%Y-%m-%dT%H:%M:%SZ")
    if sh(["git", "rev-parse", "--is-shallow-repository"]).stdout.strip() == "true":
        sh(["git", "fetch", "-q", "--no-tags", "--shallow-since=" + since, "origin", "main"])
    r = sh(["git", "log", "--since=" + since, "--format=@%ct", "--name-only", "--no-renames", "HEAD"])
    out, cur = [], None
    for l in r.stdout.splitlines():
        if l.startswith("@"):
            cur = (int(l[1:]), [])
            out.append(cur)
        elif l and cur:
            cur[1].append(l)
    return out


def pending(changes, sets=SETS, root=ROOT):
    """{set id: unix time of the newest commit that changed its code}, for the sets the commits touch"""
    out = {}
    for s in sets:
        cp = set(code_paths(s, root))
        ts = [t for t, files in changes if cp & set(files)]
        if ts:
            out[s["id"]] = max(ts)
    return out


class GH:
    def __init__(self, token, repo):
        self.token, self.repo = token, repo

    def call(self, method, path, body=None):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Authorization", "Bearer " + self.token)
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        return json.loads(data) if data else None


def _ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def pick_run(runs, since):
    """the run of the set's workflow started by hand after its code changed: newest first, None when none"""
    mine = [r for r in runs if r.get("event") == "workflow_dispatch" and _ts(r["created_at"]) >= since]
    return max(mine, key=lambda r: r["created_at"]) if mine else None


def built(gh, s, run):
    """did this finished run of the set's workflow actually rebuild? (success, and the set's build job, when it names
    one, ran: cash-bid-pages succeeds with its build job skipped when its gate finds the pages too recent)"""
    if run.get("conclusion") != "success":
        return False
    job = s.get("build_job")
    if not job:
        return True
    jobs = (gh.call("GET", "/repos/%s/actions/runs/%s/jobs?per_page=50" % (gh.repo, run["id"])) or {}).get("jobs", [])
    return any(j.get("name") == job and j.get("conclusion") == "success" for j in jobs)


def superseded(gh, s, gone, wait_min=WAIT_MIN, sleep=time.sleep, clock=time.time):
    """the watched run ended cancelled: a run of the same workflow queued after it (any trigger) takes its place in the
    workflow's concurrency group. Wait (bounded) for the newer runs on main -> 'success' when one of them rebuilt,
    'newer run <conclusion>' when one failed, 'cancelled (no newer run ...)' when none rebuilt, or 'timed out'"""
    path = "/repos/%s/actions/workflows/%s/runs?branch=main&per_page=30" % (gh.repo, s["workflow"])
    end = clock() + wait_min * 60
    while True:
        runs = (gh.call("GET", path) or {}).get("workflow_runs", [])
        newer = sorted((r for r in runs if r.get("id") != gone.get("id") and r.get("head_branch", "main") == "main"
                        and r["created_at"] > gone["created_at"]), key=lambda r: r["created_at"])
        if not newer:
            return "cancelled (no newer run)"
        done = [r for r in newer if r.get("status") == "completed"]
        for r in done:
            if built(gh, s, r):
                print("  %s run %s was superseded by run %s: success" % (s["workflow"], gone.get("id"), r.get("id")))
                return "success"
        failed = [r for r in done if r.get("conclusion") not in ("success", "cancelled", "skipped")]
        if failed:
            return "newer run %s %s" % (failed[0].get("id"), failed[0].get("conclusion"))
        if len(done) == len(newer):
            return "cancelled (no newer run rebuilt the pages)"
        if clock() >= end:
            return "timed out"
        sleep(30)


def await_network(gh, s, since, wait_min=WAIT_MIN, sleep=time.sleep, clock=time.time):
    """start the network set's own workflow (unless a run by hand already started after the code changed) and
    wait for it -> its conclusion, or 'timed out'. A run cancelled by the workflow's concurrency group counts as
    the newer run that replaced it (superseded)"""
    wf = s["workflow"]
    path = "/repos/%s/actions/workflows/%s/runs?event=workflow_dispatch&per_page=20" % (gh.repo, wf)
    run = pick_run((gh.call("GET", path) or {}).get("workflow_runs", []), since)
    if run is None:
        gh.call("POST", "/repos/%s/actions/workflows/%s/dispatches" % (gh.repo, wf), {"ref": "main", "inputs": s.get("dispatch") or {}})
        print("  started %s by hand" % wf)
        since = clock() - 30
    end = clock() + wait_min * 60
    while clock() < end:
        sleep(30)
        run = pick_run((gh.call("GET", path) or {}).get("workflow_runs", []), since)
        if run and run.get("status") == "completed":
            c = run.get("conclusion")
            print("  %s run %s: %s" % (wf, run.get("id"), c))
            if c == "cancelled":
                return superseded(gh, s, run, max(1, (end - clock()) / 60), sleep=sleep, clock=clock)
            return c
    return "timed out"


def stage_paths(s):
    pats = [p for p in s["outputs"] if not p.startswith("!")] + s["writes"]
    out = set()
    for p in pats:
        base = p.split("*")[0].rstrip("/")
        if base and os.path.exists(os.path.join(ROOT, base)):
            out.add(base)
    return sorted(out)


def commit_and_push(ids, rebuild, extra=()):
    paths = sorted({p for s in SETS if s["id"] in ids for p in stage_paths(s)} | {p for p in extra if os.path.exists(os.path.join(ROOT, p))})
    for i in range(1, 5):
        sh(["git", "add", "-A", "--"] + paths)
        if sh(["git", "diff", "--staged", "--quiet"]).returncode == 0:
            print("main: rebuilt, nothing changed (already rebuilt)")
            return 0
        print(sh(["git", "diff", "--staged", "--shortstat"]).stdout.strip())
        sh(["git", "commit", "-q", "-m", "Generated pages rebuilt on main after a builder change (%s)" % ", ".join(ids)], check=True)
        if sh(["git", "pull", "-q", "--rebase", "origin", "main"]).returncode == 0 and sh(["git", "push", "-q", "origin", "HEAD:main"]).returncode == 0:
            print("main: pushed on attempt %d" % i)
            return 0
        sh(["git", "rebase", "--abort"])
        sh(["git", "fetch", "-q", "origin", "main"])
        sh(["git", "reset", "-q", "--hard", "origin/main"])
        time.sleep(5 * i)
        if not rebuild():
            return 1
    print("::error::could not push the rebuilt generated pages after 4 attempts")
    return 1


def cmd_main(window, dry):
    changes = recent_changes(window)
    pend = pending(changes)
    print("main: %d commit(s) in the last %d minutes; sets whose code changed: %s" % (len(changes), window, ", ".join(pend) or "none"))
    if not pend or dry:
        return 0
    rc = 0
    token, repo = os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    for s in SETS:
        if s["id"] in pend and not s["offline"]:
            if not (token and repo):
                print("::warning::%s: no token to start %s; its pages wait for its next run" % (s["id"], s["workflow"]))
                continue
            try:
                c = await_network(GH(token, repo), s, pend[s["id"]])
            except (urllib.error.URLError, OSError, ValueError) as e:
                c = "error %s" % str(e)[:80]
            if c != "success":
                print("::warning::%s: its rebuild (%s) ended %s" % (s["id"], s["workflow"], c))
                rc = 1
    offline = [s for s in SETS if s["id"] in pend and s["offline"]]
    if not offline:
        return rc
    sh(["git", "fetch", "-q", "origin", "main"])
    sh(["git", "reset", "-q", "--hard", "origin/main"])

    deps = sorted({d for s in offline for d in s["dependents"]})

    def rebuild():
        ok = True
        for s in offline:
            print("main: rebuilding %s" % s["id"])
            pull_raw(s)
            ok = build(s) and ok
        if ok and deps:
            print("main: rebuilding their summary files: %s" % ", ".join(deps))
            run_dependents(deps)
        return ok
    if not rebuild():
        print("::error::a generated set failed to build on main; nothing committed")
        return 1
    return commit_and_push([s["id"] for s in offline], rebuild, summary_files(deps)) or rc


# ── dependents (build rule 61) ─────────────────────────────────────────────────
SUMMARY = {x["id"]: x for x in SUMMARIES}


def producers(path, sets=SETS):
    """ids of the sets whose builder writes this file (pages, sitemaps, data files, hub pages, llms.txt lines);
    the shared pointer files are left out"""
    out = []
    for s in sets:
        if path in s["inputs"]:
            continue
        if matches(s["outputs"], path) or any(_under(path, w) for w in s["writes"] if w not in SHARED_WRITES):
            out.append(s["id"])
    return out


def _bases(s):
    return [p.split("*")[0].rstrip("/") for p in s["outputs"] + s["writes"] if not p.startswith("!") and p not in SHARED_WRITES]


def read_sets(trace, sets=SETS, own=()):
    """{set id: [paths]}: the sets whose output a traced run read (a file opened, or a folder listed inside a set's
    output). own: the summary's own files (reading what it is about to rewrite is not reading a set)."""
    hit = {}
    for p in trace.get("read", []):
        if any(_under(p, f) for f in own):
            continue
        for i in producers(p, sets):
            hit.setdefault(i, []).append(p)
    for d in trace.get("listed", []):
        for s in sets:
            if any(b and _under(d, b) for b in _bases(s)):
                hit.setdefault(s["id"], []).append(d + "/")
    return hit


def trace(sid, root=ROOT):
    """run the summary builder's write-nothing pass under scripts/trace_reads.py -> its trace dict"""
    import tempfile
    x = SUMMARY[sid]
    fd, out = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    try:
        r = subprocess.run([PY, os.path.join(root, "scripts", "trace_reads.py"), out, os.path.join(root, x["build"][1])]
                           + x["build"][2:] + x["trace"], cwd=root, capture_output=True, text=True, timeout=TRACE_TIMEOUT)
        t = json.load(open(out, encoding="utf-8")) if os.path.getsize(out) else {"rc": r.returncode, "read": [], "listed": [], "written": []}
    finally:
        os.remove(out)
    # a whole-file write goes to <file>.tmp and is renamed into place (build_feeds.py): the temp is gone after the
    # run and is not a file the builder leaves behind
    t["written"] = [w for w in t.get("written", []) if not (w.endswith(".tmp") and not os.path.exists(os.path.join(root, w)))]
    t["log"] = (r.stdout + r.stderr)[-1500:]
    return t


def dependents_of(sid, sets=None):
    """the summaries one set feeds, in SUMMARIES order"""
    want = set(next(s for s in (sets or SETS) if s["id"] == sid)["dependents"])
    return [x for x in SUMMARIES if x["id"] in want]


def summary_closure(ids):
    """these summaries and every summary that reads one of them (a summary's own "dependents", at any depth), in
    SUMMARIES order, which is the order they are rebuilt in (a summary comes after every summary it reads)"""
    want, todo = set(), list(ids)
    while todo:
        i = todo.pop()
        if i in want:
            continue
        want.add(i)
        todo += SUMMARY[i].get("dependents", []) if i in SUMMARY else []
    return [x["id"] for x in SUMMARIES if x["id"] in want]


def summary_files(ids):
    return [f for x in SUMMARIES if x["id"] in ids for f in x["files"]]


def run_dependents(ids, dry=False, stage=False):
    """rebuild these summaries (SUMMARIES order); -> the ids that failed. Fail soft (build rule 53): a summary
    that fails to build never stops the set's own commit; it is a warning here and main's --check stays red."""
    bad = []
    for x in SUMMARIES:
        if x["id"] not in ids:
            continue
        if dry:
            print(" ".join(x["build"]))
            continue
        t = time.time()
        r = subprocess.run(x["build"], cwd=ROOT, capture_output=True, text=True)
        tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
        print("  %s: rc=%d %.0fs %s" % (" ".join(x["build"]), r.returncode, time.time() - t, tail[0][:160]))
        if r.returncode != 0:
            print((r.stdout + r.stderr)[-2000:])
            print("::warning title=summary not rebuilt::%s failed (rc=%d); %s may now trail its set (BUILD-RULES 61)"
                  % (" ".join(x["build"]), r.returncode, ", ".join(x["files"])))
            bad.append(x["id"])
            restore(x["files"])
    if stage and not dry:
        have = [f for f in summary_files([i for i in ids if i not in bad]) if os.path.exists(os.path.join(ROOT, f))]
        if have:
            sh(["git", "add", "-A", "--"] + have)
    return bad


def restore(files):
    """put a failed summary's files back as HEAD has them, so no half-built copy is staged by a bare
    `git add -A` later in the job (the builders also write whole files and rename)"""
    for f in files:
        if sh(["git", "cat-file", "-e", "HEAD:" + f]).returncode == 0:
            sh(["git", "checkout", "HEAD", "--", f])
        sh(["git", "clean", "-fdq", "--", f])


def in_rebase():
    gd = sh(["git", "rev-parse", "--git-dir"]).stdout.strip()
    gd = gd if os.path.isabs(gd) else os.path.join(GIT_ROOT, gd)
    return any(os.path.isdir(os.path.join(gd, d)) for d in ("rebase-merge", "rebase-apply"))


def pull_rebase(sids, branch="main", autostash=False):
    """git pull --rebase that never keeps either side of a summary file: when the only conflicts are summary
    files (llms.txt, the search index, data/feeds.json, ...), they are rebuilt on the rebased tree, staged and
    the rebase continues. Any other conflict aborts the rebase and returns 1 (the job's own retry or recovery
    path takes over). -> 0 when the branch is rebased onto origin/<branch>."""
    known = set(summary_files([x["id"] for x in SUMMARIES]))
    want = sorted({x["id"] for sid in sids for x in dependents_of(sid)}) if sids else [x["id"] for x in SUMMARIES]
    # the same on any runner: no identity in the config (the rebase commits as the bot), no editor, the
    # autostash setting stated, never read from the machine's config
    ident = []
    for k, v in (("user.name", "AGSIST Bot"), ("user.email", "bot@agsist.com")):
        if not sh(["git", "config", k]).stdout.strip():
            ident += ["-c", "%s=%s" % (k, v)]
    git = ["git"] + ident + ["-c", "core.editor=true", "-c", "rebase.autoStash=%s" % ("true" if autostash else "false")]
    cmd = git + ["pull", "-q", "--rebase", "--no-edit"] + (["--autostash"] if autostash else ["--no-autostash"]) + ["origin", branch]
    r = sh(cmd)
    for _ in range(50):
        if r.returncode == 0 and not in_rebase():
            return 0
        if not in_rebase():
            print("pull-rebase: git pull failed: %s" % (r.stdout + r.stderr).strip()[-300:])
            return 1
        un = [l for l in sh(["git", "diff", "--name-only", "--diff-filter=U"]).stdout.splitlines() if l]
        if not un:
            print("pull-rebase: the rebase stopped with no conflict: %s; rebase aborted" % (r.stdout + r.stderr).strip()[-300:])
            sh(["git", "rebase", "--abort"])
            return 1
        if not all(any(_under(f, k) for k in known) for f in un):
            print("pull-rebase: a conflict outside the summary files (%d file(s)); rebase aborted" % len(un))
            sh(["git", "rebase", "--abort"])
            return 1
        print("pull-rebase: %d summary file(s) conflicted; rebuilding them on the rebased tree" % len(un))
        for f in un:   # main's copy first, so a failed rebuild leaves a whole file, never conflict markers
            sh(["git", "checkout", "--ours", "--", f])
        ids = sorted(set(want) | {x["id"] for x in SUMMARIES if any(_under(f, k) for f in un for k in x["files"])})
        run_dependents(ids)
        sh(["git", "add", "-A", "--"] + [f for f in summary_files(ids) if os.path.exists(os.path.join(GIT_ROOT, f))] + un)
        r = sh(git + ["rebase", "--continue"])
    sh(["git", "rebase", "--abort"])
    return 1


def cmd_dependents(sids, dry, stage, files):
    """the summary files of these sets (a workflow that rebuilds several sets names each), rebuilt once each"""
    bad = [x for x in sids if x not in {s["id"] for s in SETS}]
    if not sids or bad:
        print("generated_sets.py dependents: name the set(s) rebuilt: %s" % ", ".join(s["id"] for s in SETS), file=sys.stderr)
        return 2
    want = {x["id"] for sid in sids for x in dependents_of(sid)}
    ids = [x["id"] for x in SUMMARIES if x["id"] in want]
    if files:
        print(" ".join(summary_files(ids)))
        return 0
    print("summary files of %s: %s" % (", ".join(sids), ", ".join(ids) or "none"))
    run_dependents(ids, dry, stage)
    return 0


# ── table ──────────────────────────────────────────────────────────────────────
def table():
    return [dict(s, code_paths=code_paths(s), stage=stage_paths(s)) for s in SETS]


def selftest():
    fails = []

    def check(ok, name):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)
    check(owner("rain/iowa/story-county.html") == "rain", "a county rain page belongs to the rain set")
    check(owner("farmland-atlas/compare.html") is None, "the Atlas compare page is written by hand")
    check(owner("farmland-atlas/og/19169.png") == "farmland-atlas", "a share card committed here again is guarded like the pages")
    check(owner("farmland-atlas/iowa/story-county.html") == "farmland-atlas", "an Atlas county page")
    check(owner("rain.html") is None and owner("prf.html") is None, "hub pages edited by hand are not outputs")
    check(owner("scripts/build_county_rain.py") is None, "a builder is not an output")
    check(owner("data/land-sales/coverage.json") is None, "the hand-kept land coverage table is not an output")
    check(owner("data/land-sales/IL.json") == "land-sales" and owner("data/arc-plc/math/IA.json") == "arc-plc"
          and owner("data/prf/facts.json") == "prf" and owner("data/land/names/il/17113.json") == "land-sales"
          and owner("data/land/names/2026-10.json") == "land-sales" and owner("data/land/il/17113.json") is None,
          "the data files a builder writes are guarded like its pages (the land names too; the transfer files are inputs)")
    check(owner("data/pointers/rain.json") is None and owner("sitemap.xml") is None and owner("llms.txt") is None,
          "shared files several builders rewrite are not guarded")
    rel = relevant(["scripts/build_county_rain.py"])
    check(rel("rain/iowa/x.html") and rel("scripts/build_county_rain.py") and not rel("cash-bids/iowa/ames.html"),
          "relevant to a builder change: its own set's pages, not another set's")
    ok, msg = guard(["scripts/build_county_rain.py", "test/rain.test.mjs"])
    check(ok, "a builder and its test: passes")
    ok, msg = guard(["scripts/build_county_rain.py", "rain/iowa/story-county.html", "cash-bids/iowa/ames.html"], "dnilgis")
    check(not ok and msg.startswith("generated pages are built on main; change the builder and its fixture tests only.")
          and "  cash-bids: 1 file(s)" in msg and "  rain: 1 file(s)" in msg, "pages changed by hand: fails and names each set")
    check(guard(["rain/iowa/story-county.html"], "github-actions[bot]")[0], "the data bot may")
    check(guard(["rain/iowa/story-county.html"], "dnilgis", ["merge-when-green", LABEL])[0], "the regen-ok label lets it through")
    check(not guard(["rain/iowa/story-county.html"], "dnilgis", ["merge-when-green"])[0], "another label does not")
    check(all(f in code_paths(next(s for s in SETS if s["id"] == "prf")) for f in NAV_FILES),
          "a set whose builder bakes the menu (prf, through inject_static_nav) counts the menu files as its code")
    check("cash-bid-index" in touched(SETS, ["grain-emc.html"]), "the Cash Bid Index page is rebuilt when grain-emc.html (its menu source) changes")
    check(not set(NAV_FILES) & set(code_paths(next(s for s in SETS if s["id"] == "land-sales"))),
          "a set that does not bake the menu does not")
    cp = code_paths(next(s for s in SETS if s["id"] == "rain"))
    check("scripts/build_county_rain.py" in cp and "scripts/cross_links.py" in cp, "a set's code is its builder and what it imports")
    check(touched(SETS, ["scripts/cross_links.py"]) and "rain" in touched(SETS, ["scripts/cross_links.py"]), "a shared module touches every set that imports it")
    check(touched(SETS, ["hail-map.html"]) == ["hail-map"], "a hand-kept input touches its set")
    check(touched(SETS, ["README.md", "rain/iowa/x.html"]) == [], "pages and other files touch no set's code")
    ch = [(100, ["data/bids.json"]), (200, ["scripts/build_county_rain.py"]), (300, ["scripts/build_county_rain.py", "x"])]
    check(pending(ch) .get("rain") == 300 and "cash-bids" not in pending(ch), "pending: the newest code change per set")
    check(pending([(5, ["rain/iowa/x.html"])]) == {}, "a data commit to the pages is not a code change")
    runs = [{"event": "workflow_run", "created_at": "2026-11-04T10:05:00Z"},
            {"event": "workflow_dispatch", "created_at": "2026-11-04T09:00:00Z"},
            {"event": "workflow_dispatch", "created_at": "2026-11-04T10:10:00Z", "id": 7}]
    since = _ts("2026-11-04T10:00:00Z")
    check((pick_run(runs, since) or {}).get("id") == 7, "a network set waits on a run by hand started after the change")
    check(pick_run(runs[:2], since) is None, "a chained run or an older run by hand does not count")
    check(producers("cash-bid-index.html") == ["cash-bid-index"] and producers("data/cash-index/editions.json") == ["cash-bid-index"]
          and producers("data/cash-index/acc-2026-11.json") == [], "the Cash Bid Index is a set; the folded days are not its output")
    check(owner("data/cash-index/acc-2026-11.json") is None, "the daily fold (fetch_bids.yml) is not guarded")
    check(sorted(producers("sitemap.xml")) == ["hail", "hail-map"] and producers("data/pointers/rain.json") == [],
          "producers: every set that writes a shared file, never the pointers")
    tr = {"read": ["data/cash-index/editions.json", "llms.txt", "rain/iowa/x.html", "README.md"], "listed": ["cash-bids/iowa", "data"]}
    got = read_sets(tr, own=["llms.txt"])
    check(sorted(got) == ["cash-bid-index", "cash-bids", "rain"], "read_sets: files and folders inside a set's output, not its own file (%s)" % sorted(got))
    check([x["id"] for x in dependents_of("cash-bid-index")] == ["feeds", "llms"] and "llms.txt" in summary_files(["llms"]),
          "the Cash Bid Index rebuilds llms.txt (Nov 4)")
    check(all(d in SUMMARY for s in SETS for d in s["dependents"]), "every dependent is a summary")
    order = [x["id"] for x in SUMMARIES]
    check(all(d in SUMMARY and order.index(d) > order.index(x["id"]) for x in SUMMARIES for d in x.get("dependents", [])),
          "a summary that reads another summary is rebuilt after it")
    check(summary_closure(["llms", "breakeven"]) == ["breakeven", "llms"], "summary_closure: SUMMARIES order")
    check(all(x["build"][1].endswith(".py") for x in SUMMARIES), "summary builders are Python (the tracer runs them)")
    ids = [s["id"] for s in SETS]
    check(len(ids) == len(set(ids)), "every set once")
    check(all(s["build"] and s["workflow"] and s["outputs"] for s in SETS), "every set has a builder, a workflow and outputs")
    print("FAILS=%d" % len(fails) if fails else "all generated_sets checks passed")
    return 1 if fails else 0


def main(argv):
    global GIT_ROOT
    if "--root" in argv:
        GIT_ROOT = os.path.abspath(argv[argv.index("--root") + 1])
        argv = argv[:argv.index("--root")] + argv[argv.index("--root") + 2:]
    if "--selftest" in argv:
        return selftest()
    args = [a for a in argv if not a.startswith("--")]
    opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else d
    cmd = args[0] if args else "table"
    if cmd == "table":
        for s in table():
            print("%-15s %-8s %-26s check=%s  outputs=%s" % (s["id"], "offline" if s["offline"] else "network", s["workflow"],
                  "yes" if s["check"] else "no", " ".join(s["outputs"])))
        return 0
    if cmd == "json":
        print(json.dumps({"sets": table(), "not_sets": NOT_SETS, "not_set_checks": NOT_SET_CHECKS,
                          "summaries": SUMMARIES, "not_summaries": NOT_SUMMARIES}, indent=1))
        return 0
    if cmd == "guard":
        return cmd_guard(opt("--base", "HEAD^1"))
    if cmd == "prebuild":
        return cmd_prebuild(opt("--base", "HEAD^1"))
    if cmd == "dependents":
        return cmd_dependents(args[1:], "--dry-run" in argv, "--stage" in argv, "--files" in argv)
    if cmd == "pull-rebase":
        return pull_rebase(args[1:], opt("--branch", "main"), "--autostash" in argv)
    if cmd == "trace":
        sid = args[1] if len(args) > 1 else ""
        if sid not in SUMMARY:
            print("generated_sets.py: no summary %r (%s)" % (sid, ", ".join(SUMMARY)), file=sys.stderr)
            return 2
        x = SUMMARY[sid]
        t = trace(sid)
        print(json.dumps({"id": sid, "rc": t["rc"], "written": t["written"], "log": t["log"],
                          "sets": {k: sorted(v)[:5] for k, v in read_sets(t, own=x["files"]).items()},
                          "summaries": [y["id"] for y in SUMMARIES if y["id"] != sid
                                        and any(_under(p, f) for p in t["read"] for f in y["files"])]}, indent=1))
        return 0
    if cmd == "main":
        return cmd_main(int(opt("--window", WINDOW_MIN)), "--dry-run" in argv)
    print("generated_sets.py: unknown command %r" % cmd, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
