#!/usr/bin/env python3
"""generated_sets.py: the one table of generated page sets, and the three things that use it (Nov 4, 2026).

WHY. On Nov 3 four pull requests carried generated page sets (#280 the rain set, #282 the cash bid town pages
twice, #296 land sales). Main's own jobs rebuild those sets every 15 minutes to once a day, so a pull request's
copy went stale within hours: merge conflicts, or a merge on checks run against an older main and main red
(build_*.py --check). BUILD-RULES 49 and 60 asked the lead to remember; this makes it mechanical.

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
             (AGSIST_PREBUILD), so the --check and the tests see what main will serve after the rebuild. Nothing
             is committed. A network set (cash bid pages) is not rebuilt here: its tests run on fixtures.
  main       (main-checks.yml, the generated job, before the suite) a set whose code changed on main in the last
             WINDOW_MIN minutes is rebuilt at once: an offline set here, from main as it is, and committed; a
             network set by starting its own workflow by hand and waiting for that run. A set whose code did not
             change is left alone, so a stale set from a failing data job still shows red.

    python3 scripts/generated_sets.py table                 print the table
    python3 scripts/generated_sets.py json                  the table as JSON (the inventory test reads it)
    python3 scripts/generated_sets.py guard --base HEAD^1   pr-checks guard (pull request event; --root DIR
                                                            diffs another checkout, for the tests)
    python3 scripts/generated_sets.py prebuild --base HEAD^1
    python3 scripts/generated_sets.py main --window 360 [--dry-run]
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
     "build": [[PY, "scripts/build_cash_bid_pages.py"]], "check": None,
     "outputs": ["cash-bids/**", "sitemap-cash-bids.xml"],
     "writes": [], "code": ["scripts/build_cash_bid_pages.py"], "inputs": []},
    {"id": "prf", "offline": True, "workflow": "prf.yml",
     "build": [["node", "scripts/prf_facts.mjs"], [PY, "scripts/build_prf_states.py"], [PY, "scripts/build_prf_counties.py"]],
     "check": [[PY, "scripts/build_prf_states.py", "--check"], [PY, "scripts/build_prf_counties.py", "--check"]],
     "outputs": ["prf/**", "sitemap-prf.xml"],
     "writes": ["data/prf/facts.json", "data/pointers"],
     "code": ["scripts/build_prf_states.py", "scripts/build_prf_counties.py", "scripts/prf_facts.mjs",
              "scripts/prf_county_facts.mjs", "components/prf-math.js"], "inputs": []},
    {"id": "arc-plc", "offline": True, "workflow": "arc-plc-refresh.yml", "raw": ["data/fsa"],
     "build": [[PY, "scripts/build_arc_plc.py"]], "check": [[PY, "scripts/build_arc_plc.py", "--check"]],
     "outputs": ["arc-plc/**", "sitemap-arc-plc.xml"],
     "writes": ["data/arc-plc", "arc-plc.html", "data/arc-plc.json", "components/arc-plc-form.js", "embed/arc-plc.html", "llms.txt",
                "data/pointers"],
     "code": ["scripts/build_arc_plc.py"], "inputs": []},
    {"id": "land-sales", "offline": True, "workflow": "land-data.yml",
     "build": [[PY, "scripts/build_land_sales.py"]], "check": [[PY, "scripts/build_land_sales.py", "--check"]],
     "outputs": ["land-sales/**", "sitemap-land-sales.xml"],
     "writes": ["data/land-sales", "data/land/names"],
     "code": ["scripts/build_land_sales.py"],
     # kept by hand (build_land_sales.py: the coverage table, the removed-name list)
     "inputs": ["data/land-sales/coverage.json", "data/land-sales/removed.json"]},
    {"id": "rain", "offline": True, "workflow": "county-rain.yml",
     "build": [[PY, "scripts/build_county_rain.py"]], "check": [[PY, "scripts/build_county_rain.py", "--check"]],
     "outputs": ["rain/**", "sitemap-rain.xml"],
     "writes": ["rain.html", "data/pointers"], "code": ["scripts/build_county_rain.py"], "inputs": []},
    {"id": "farmland-atlas", "offline": True, "workflow": "farmland-atlas-pages.yml",
     "build": [[PY, "scripts/build_atlas_pages.py"]], "check": None,
     # compare, methods, sheet and qr.js are written by hand; the share cards are the atlas-cards set
     "outputs": ["farmland-atlas/**", "!farmland-atlas/og/**", "!farmland-atlas/compare.html",
                 "!farmland-atlas/methods.html", "!farmland-atlas/sheet.html", "!farmland-atlas/qr.js", "sitemap-atlas.xml"],
     "writes": ["data/pointers"], "code": ["scripts/build_atlas_pages.py"], "inputs": []},
    {"id": "atlas-cards", "offline": True, "workflow": "farmland-atlas-pages.yml",
     "build": [[PY, "scripts/build_atlas_cards.py"]], "check": None,
     "outputs": ["farmland-atlas/og/**"], "writes": [], "code": ["scripts/build_atlas_cards.py"], "inputs": []},
    {"id": "rent", "offline": True, "workflow": "state-rent-pages.yml",
     "build": [[PY, "scripts/build_state_rent_pages.py"]], "check": None,
     "outputs": ["rent/**"], "writes": [], "code": ["scripts/build_state_rent_pages.py"], "inputs": []},
    {"id": "yield", "offline": True, "workflow": "yield-pages.yml",
     "build": [[PY, "scripts/build_state_yield_pages.py"]], "check": None,
     "outputs": ["yield/**"], "writes": [], "code": ["scripts/build_state_yield_pages.py"], "inputs": []},
    {"id": "hail", "offline": True, "workflow": "mesh.yml",
     "build": [[PY, "scripts/generate_hail_events.py"]], "check": None,
     "outputs": ["hail/**"], "writes": ["hail-map.html", "sitemap.xml", "data/hail/storm-days.json"],
     "code": ["scripts/generate_hail_events.py"], "inputs": []},
    {"id": "hail-map", "offline": True, "workflow": "hail-states.yml",
     "build": [[PY, "scripts/generate_hail_states.py"]], "check": None,
     "outputs": ["hail-map/**"], "writes": ["sitemap.xml"],
     # the state pages copy the ?v= the map page carries for its scripts
     "code": ["scripts/generate_hail_states.py"], "inputs": ["hail-map.html"]},
]

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
    ids = touched(SETS, files)
    if not ids:
        print("prebuild: no generated set's code changed against %s" % base)
        return 0
    bad = 0
    for s in SETS:
        if s["id"] not in ids:
            continue
        if not s["offline"]:
            print("prebuild: %s reads the live network; not rebuilt here (its tests run on fixtures; main rebuilds it "
                  "after the merge with %s)" % (s["id"], s["workflow"]))
            continue
        print("prebuild: %s (its code changed)" % s["id"])
        pull_raw(s)
        bad += not build(s)
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


def await_network(gh, s, since, wait_min=WAIT_MIN):
    """start the network set's own workflow (unless a run by hand already started after the code changed) and
    wait for it -> its conclusion, or 'timed out'"""
    wf = s["workflow"]
    path = "/repos/%s/actions/workflows/%s/runs?event=workflow_dispatch&per_page=20" % (gh.repo, wf)
    run = pick_run((gh.call("GET", path) or {}).get("workflow_runs", []), since)
    if run is None:
        gh.call("POST", "/repos/%s/actions/workflows/%s/dispatches" % (gh.repo, wf), {"ref": "main", "inputs": s.get("dispatch") or {}})
        print("  started %s by hand" % wf)
        since = time.time() - 30
    end = time.time() + wait_min * 60
    while time.time() < end:
        time.sleep(30)
        run = pick_run((gh.call("GET", path) or {}).get("workflow_runs", []), since)
        if run and run.get("status") == "completed":
            print("  %s run %s: %s" % (wf, run.get("id"), run.get("conclusion")))
            return run.get("conclusion")
    return "timed out"


def stage_paths(s):
    pats = [p for p in s["outputs"] if not p.startswith("!")] + s["writes"]
    out = set()
    for p in pats:
        base = p.split("*")[0].rstrip("/")
        if base and os.path.exists(os.path.join(ROOT, base)):
            out.add(base)
    return sorted(out)


def commit_and_push(ids, rebuild):
    paths = sorted({p for s in SETS if s["id"] in ids for p in stage_paths(s)})
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

    def rebuild():
        ok = True
        for s in offline:
            print("main: rebuilding %s" % s["id"])
            pull_raw(s)
            ok = build(s) and ok
        return ok
    if not rebuild():
        print("::error::a generated set failed to build on main; nothing committed")
        return 1
    return commit_and_push([s["id"] for s in offline], rebuild) or rc


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
    check(owner("farmland-atlas/og/19169.png") == "atlas-cards", "the Atlas share cards are their own set")
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
        print(json.dumps({"sets": table(), "not_sets": NOT_SETS, "not_set_checks": NOT_SET_CHECKS}, indent=1))
        return 0
    if cmd == "guard":
        return cmd_guard(opt("--base", "HEAD^1"))
    if cmd == "prebuild":
        return cmd_prebuild(opt("--base", "HEAD^1"))
    if cmd == "main":
        return cmd_main(int(opt("--window", WINDOW_MIN)), "--dry-run" in argv)
    print("generated_sets.py: unknown command %r" % cmd, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
