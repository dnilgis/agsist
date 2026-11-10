#!/usr/bin/env python3
"""Merge a pull request labeled "merge-when-green" once its PR checks are green (Oct 29, 2026).

GitHub's own auto-merge needs required checks on main, which would stop the data jobs that commit
straight to main, so .github/workflows/merge-when-green.yml does it instead. For every open pull
request with the label it merges (a squash, through the API, with the job token) only when:
  - the branch is in this repository (never a fork) and the pull request is not a draft;
  - the newest pr-checks run for the head commit has every job finished and green: guard, other
    checks, each node test shard and all checks;
  - GitHub says the merge is clean (mergeable_state "clean": no conflict, nothing else red).
Red, pending, conflicted or behind: no merge. A red or conflicted head gets one comment saying why
(once per head commit and reason); a pending one waits for the next pr-checks run to finish.

No merge on stale checks (Nov 4, 2026; build rule 60: #280 and #282 merged on checks run against an older
main and main went red). Green checks ran against main as it was when they started (the checked base: main at
the run's start for a pull_request run, the branch's merge base for a run this script started). When main has
since changed a file that can change the result, the bot updates the branch from main (GitHub's update
branch), starts pr-checks on the new head by hand (a push by the job token starts no pull_request run) and
merges only when that fresh run is green. "Can change the result" (stale()): a file the pull request changes,
or an output or data file of a generated set whose builder the pull request changes (scripts/generated_sets.py
relevant(): the PR checks rebuild that set from them, and its code). Main's changed files come from git (a shallow
fetch of the base and main, then git diff --name-only), so the bot's 900 to 2,900 file data commits are read whole.

Data commits do not hold a builder's pull request (Nov 4, 2026, #308; build rule 60 amended: checks green at 08:10
UTC and still not merged at 09:27, since the bids bot rewrote the set it builds every 15 minutes and each fresh run was
stale again). Main's own commits since the base are read along its first parents (a merge is one commit: what it
brought in); a set's outputs and data changed only by scheduled data commits (data_bot_commit(): one parent, the data
bots' address as author and committer, no "(#NNN)" suffix) do not make the checks stale, since pull requests carry
no pages (#300) and main rebuilds the set with the new builder after the merge. Still stale: main changed a file the
pull request changes (whoever did), another pull request's merge or any other commit changed a relevant file, main
changed a workflow file, or main's changes or history cannot be read (then every change counts).

No silent loop: after MAX_UPDATES updates from main for one kind of reason (counted from the bot's own comments since
the label was last added) the bot says so once and stops updating; merge by hand, or remove and add the label again.

Squash, with a message from the body only (Nov 4, 2026; build rule 38): the commit title is the pull request's
title plus " (#N)", the message is its body with the AI footer lines stripped (scripts/dev/ai_footer_check.py
strip()). Never GitHub's default squash body, which joins every commit message: that is how Co-Authored-By: Claude
and Claude-Session: lines reached main (#304). The PR checks fail a body with a footer and only warn on commits.

A merge by the job token starts no push run on main, so after a merge this starts main-checks.yml
by hand, and every workflow that would have run on that push (push to main, its paths matching the
merged files, workflow_dispatch on) the same way.

  python3 scripts/dev/merge_when_green.py              (in merge-when-green.yml)
  python3 scripts/dev/merge_when_green.py --selftest
"""
import calendar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try: import _argguard; _argguard.guard(__file__)  # scripts/_argguard.py: --help and bad flags exit before any work
except ImportError: pass
sys.path.pop(0)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from ai_footer_check import strip as strip_footer  # noqa: E402  (the one list of footer lines)
except ImportError:  # an engine copy without it: the PR checks already fail a body with a footer, so the body goes as is
    def strip_footer(text):
        print("::warning::scripts/dev/ai_footer_check.py is missing; the squash message is the body unstripped")
        return (text or "").rstrip()
sys.path.pop(0)

LABEL = "merge-when-green"
API = "https://api.github.com"
MARK = "<!-- merge-when-green:%s:%s -->"
SHARDS = 8
REQUIRED = ["guard", "other checks", "all checks"] + ["node tests (%d/%d)" % (i, SHARDS) for i in range(1, SHARDS + 1)]
FULL_SUITE = "main-checks.yml"


WORKFLOW_DIR = ".github/workflows/"


def decide(pr, repo, jobs, files=(), stale_reason=None):
    """-> (action, reason): action 'merge', 'update' (bring main in and check again), 'wait' (say
    nothing yet) or 'no' (say why, once). pr: the pull request object from the API; jobs: the jobs of
    the newest pr-checks run for its head commit ([] when there is none); files: the paths the pull
    request changes; stale_reason: stale() of main since the checks' base (None: not stale)."""
    labels = {l.get("name") for l in pr.get("labels", [])}
    if pr.get("state") != "open":
        return "wait", "not open"
    if LABEL not in labels:
        return "wait", "no merge-when-green label"
    head_repo = ((pr.get("head") or {}).get("repo") or {}).get("full_name")
    if head_repo != repo:
        return "no", "it comes from a fork (%s); merge-when-green only merges branches of %s" % (head_repo, repo)
    if pr.get("draft"):
        return "wait", "draft"
    by_name = {}
    for j in jobs:
        by_name[j.get("name", "").split(" / ")[-1]] = j
    missing = [n for n in REQUIRED if n not in by_name]
    if not jobs or missing:
        return "wait", "the PR checks have not run on this head yet" if not jobs else "no %s job yet" % ", ".join(missing)
    pending = [n for n in REQUIRED if by_name[n].get("status") != "completed"]
    if pending:
        return "wait", "still running: " + ", ".join(pending)
    red = [n for n in REQUIRED if by_name[n].get("conclusion") != "success"]
    if red:
        return "no", "not green: " + ", ".join("%s %s" % (n, by_name[n].get("conclusion")) for n in red)
    state = pr.get("mergeable_state")
    if state in (None, "unknown"):
        return "wait", "GitHub is still working out whether it merges cleanly"
    if state == "dirty":
        return "no", "it conflicts with main; merge main into the branch and push"
    if state != "clean" or pr.get("mergeable") is False:
        return "no", "GitHub does not call the merge clean (%s)" % state
    # The job token has no "workflows" permission, and GitHub refuses a push or merge by a token
    # without it that adds or changes a file under .github/workflows/; so those are merged by hand.
    wf = [f for f in files if f.startswith(WORKFLOW_DIR)]
    if wf:
        return "no", "merge by hand: touches workflows (%s); the job token cannot merge a change to .github/workflows" % ", ".join(wf[:3])
    if stale_reason:
        return "update", "the checks ran against an older main: " + stale_reason
    return "merge", "every PR check green and the merge is clean"


BOT = "github-actions[bot]"
RECHECK_WAIT_S = 300        # how long to wait for update-branch to move the head before starting the checks
HEAD_SETTLE_S = 180         # a head this old with no pr-checks run at all gets one started


def squash_message(pr):
    """(commit_title, commit_message) for the squash: the title plus " (#N)", and the body alone with its AI
    footer lines stripped. The commits' own messages are never used."""
    title = (pr.get("title") or "").strip()
    if not re.search(r"\(#%d\)$" % pr["number"], title):   # a title that already ends in its own (#N) keeps one
        title = "%s (#%d)" % (title, pr["number"])
    return title, strip_footer((pr.get("body") or "").replace("\r\n", "\n")).strip()


def pick_run(runs, head_ref):
    """the newest pr-checks run that counts for a head: a pull_request run, or a full run this script
    started on the branch (by hand with no pick, so every test); never a replay someone started by hand"""
    ok = [r for r in runs if r.get("event") == "pull_request"
          or (r.get("event") == "workflow_dispatch" and (r.get("triggering_actor") or r.get("actor") or {}).get("login") == BOT
              and r.get("head_branch") == head_ref)]
    return max(ok, key=lambda r: (r.get("created_at") or "", r.get("run_number", 0))) if ok else None


def stale(pr_files, main_files, relevant=None, others=None):
    """-> why the checks are stale, or None. main_files: every file main changed since the checks' base
    (None: they could not be read); relevant: path -> bool, the files that can change this pull request's
    checks (default: the files it changes); others: the files main's commits other than the data bots' own
    changed (main_commits(); None: unknown, so every change counts)."""
    if main_files is None:
        return "main's changes since the checks' base could not be read"
    wf = sorted(f for f in main_files if f.startswith(WORKFLOW_DIR))
    if wf:
        return "main changed %d workflow file(s) since (%s)" % (len(wf), ", ".join(wf[:3]))
    mine = set(pr_files)
    rel = relevant or mine.__contains__
    pool = set(main_files) if others is None else set(others) & set(main_files)
    both = sorted(f for f in main_files if f in mine or (f in pool and rel(f)))
    if both:
        return "main changed %d file(s) this pull request's checks read since (%s)" % (len(both), ", ".join(both[:3]))
    return None


# Who commits data straight to main (the bids, prices, rain, freshness and summary jobs; git config in
# .github/workflows). Any job, or anyone who sets these in git, can commit as them, so the address alone is not
# enough: a data commit also has one parent and no "(#NNN)" pull request suffix, and its committer is the bot,
# never GitHub (noreply@github.com commits every merge and squash done through GitHub, the bot's merges too).
# sig@agsist.com commits from two jobs but is the owner's own address too: not here, so those count (stale, never a
# blind merge).
DATA_BOT_EMAILS = {"bot@agsist.com", "actions@users.noreply.github.com", "actions@github.com",
                   "github-actions[bot]@users.noreply.github.com", "41898282+github-actions[bot]@users.noreply.github.com"}
PR_SUFFIX = re.compile(r"\(#\d+\)\s*$")


def data_bot_commit(c):
    """c: {"parents": n, "author": email, "committer": email, "subject": first line}: a scheduled data commit"""
    subject = c.get("subject") or ""
    return (c.get("parents") == 1 and c.get("author") in DATA_BOT_EMAILS and c.get("committer") in DATA_BOT_EMAILS
            and not PR_SUFFIX.search(subject) and not subject.startswith("Merge "))


def others_of(commits):
    """the files changed by the commits that are not data bot commits: [(meta, files)] -> sorted list"""
    out = set()
    for meta, files in commits:
        if not data_bot_commit(meta):
            out.update(files)
    return sorted(out)


def glob_re(pat):
    out, i = "", 0
    while i < len(pat):
        if pat.startswith("**", i):
            out += ".*"
            i += 2
            if pat.startswith("/", i):
                out = out[:-2] + "(?:.*/)?"
                i += 1
        elif pat[i] == "*":
            out += "[^/]*"
            i += 1
        elif pat[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(pat[i])
            i += 1
    return re.compile(out + r"\Z")


def matches(pats, path):
    """GitHub's paths filter: the last pattern that matches decides; '!' patterns exclude"""
    hit = False
    for p in pats:
        neg = p.startswith("!")
        if glob_re(p[1:] if neg else p).match(path):
            hit = not neg
    return hit


def push_followups(workflows, files):
    """workflow file -> True when a push of these files to main would have started it.
    workflows: {file name: parsed yaml 'on' block}."""
    out = []
    for name, on in sorted(workflows.items()):
        if not isinstance(on, dict) or "push" not in on or name == FULL_SUITE:
            continue
        push = on.get("push") or {}
        br = push.get("branches")
        if br is not None and not any(glob_re(b).match("main") for b in br if not b.startswith("!")):
            continue
        if push.get("paths") is not None and not any(matches(push["paths"], f) for f in files):
            continue
        if push.get("paths-ignore") is not None and all(matches(push["paths-ignore"], f) for f in files):
            continue
        out.append(name)
    return out


INDEXNOW_MAX = 50


# workflows that diff the push (event.before or HEAD~1 against HEAD): a hand start gets the merged
# range instead, since a collection job may have pushed to main between the merge and the start
RANGE_INPUTS = {"preship.yml", "sitemap.yml"}


def inputs_for(wf, files, base=None, head=None):
    """the inputs a hand start needs to do what the push would have done (None: do not start it).
    preship.yml and sitemap.yml compare the merge's own range, base (main before the merge) to head
    (the merge commit). indexnow.yml by hand with no URLs sends every sitemap (14,000 pages), so it
    gets the changed pages, as its push run sends them; a change to more pages is a template change
    and the weekly run covers it, as the push run says."""
    if wf in RANGE_INPUTS:
        if not (base and head and re.fullmatch(r"[0-9a-f]{40}", base) and re.fullmatch(r"[0-9a-f]{40}", head)):
            return None
        return {"base": base, "head": head}
    if wf != "indexnow.yml":
        return {}
    pages = [f for f in files if f.endswith(".html") and not f.startswith(("components/", "test/", "embed/"))]
    if not pages or len(pages) > INDEXNOW_MAX:
        return None
    urls = []
    for f in pages:
        u = f[:-len("index.html")] if f.endswith("index.html") else f[:-len(".html")]
        urls.append("https://agsist.com/" + u)
    return {"urls": ",".join(urls)}


def dispatchable(on):
    wd = on.get("workflow_dispatch", False) if isinstance(on, dict) else False
    if "workflow_dispatch" not in (on or {}):
        return False, "no workflow_dispatch"
    for k, v in ((wd or {}).get("inputs") or {}).items():
        if (v or {}).get("required") and "default" not in (v or {}):
            return False, "input %s is required" % k
    return True, ""


class GH:
    def __init__(self, token, repo):
        self.token, self.repo = token, repo

    def call(self, method, path, body=None):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        return json.loads(data) if data else None

    def all(self, path):
        out, page = [], 1
        while True:
            sep = "&" if "?" in path else "?"
            r = self.call("GET", "%s%sper_page=100&page=%d" % (path, sep, page))
            items = r if isinstance(r, list) else (r.get("jobs") or r.get("workflow_runs") or [])
            out += items
            if len(items) < 100:
                return out
            page += 1


def load_workflows(root):
    import yaml
    d = os.path.join(root, ".github", "workflows")
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith((".yml", ".yaml")):
            y = yaml.safe_load(open(os.path.join(d, f), encoding="utf-8")) or {}
            out[f] = y.get(True, y.get("on"))
    return out


def comment_once(gh, repo, pr, key, text):
    marker = MARK % (pr["head"]["sha"][:12], key)
    for c in gh.all("/repos/%s/issues/%d/comments" % (repo, pr["number"])):
        if marker in (c.get("body") or ""):
            return
    gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, pr["number"]), {"body": text + " " + marker})


def main():
    token, repo = os.environ["GH_TOKEN"], os.environ["GITHUB_REPOSITORY"]
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    gh = GH(token, repo)
    try:
        gh.call("POST", "/repos/%s/labels" % repo, {"name": LABEL, "color": "0e8a16",
                "description": "merge with a merge commit once every PR check is green and the merge is clean"})
        print("created the %s label" % LABEL)
    except urllib.error.HTTPError as e:
        if e.code != 422:     # 422: it is there already
            raise
    prs = [p for p in gh.all("/repos/%s/pulls?state=open&base=main" % repo) if LABEL in {l["name"] for l in p.get("labels", [])}]
    print("%d open pull request(s) labeled %s" % (len(prs), LABEL))
    workflows = None
    for p in prs:
        pr = gh.call("GET", "/repos/%s/pulls/%d" % (repo, p["number"]))
        if pr.get("mergeable_state") in (None, "unknown"):
            time.sleep(5)       # GitHub works it out on the first read
            pr = gh.call("GET", "/repos/%s/pulls/%d" % (repo, p["number"]))
        sha = pr["head"]["sha"]
        runs = gh.call("GET", "/repos/%s/actions/workflows/pr-checks.yml/runs?head_sha=%s&per_page=20" % (repo, sha)) or {}
        run = pick_run(runs.get("workflow_runs", []), pr["head"]["ref"])
        if not runs.get("workflow_runs") and LABEL in {l["name"] for l in pr.get("labels", [])} and not pr.get("draft") \
                and ((pr.get("head") or {}).get("repo") or {}).get("full_name") == repo:
            try:
                when = ((gh.call("GET", "/repos/%s/commits/%s" % (repo, sha)) or {}).get("commit") or {}).get("committer", {}).get("date")
                age = time.time() - calendar.timegm(time.strptime(when, "%Y-%m-%dT%H:%M:%SZ")) if when else None
            except (urllib.error.HTTPError, ValueError):
                age = None
            if needs_run([], age) and dispatch_checks(gh, repo, pr["head"]["ref"]):
                print("#%d %s: no PR checks on this head; started them" % (pr["number"], sha[:12]))
                continue
        jobs = gh.all("/repos/%s/actions/runs/%d/jobs" % (repo, run["id"])) if run else []
        files = [f["filename"] for f in gh.all("/repos/%s/pulls/%d/files" % (repo, pr["number"]))]
        why_stale = None
        if run and decide(pr, repo, jobs, files)[0] == "merge":
            why_stale = checks_stale(gh, repo, run, sha, files, root)
        action, why = decide(pr, repo, jobs, files, why_stale)
        print("#%d %s: %s (%s)" % (pr["number"], sha[:12], action, why))
        if action == "wait":
            continue
        if action == "no":
            key = re.sub(r"[^a-z]+", "-", why.split(":")[0].lower()).strip("-")[:40]
            comment_once(gh, repo, pr, key, "Not merged (merge-when-green): %s." % why)
            continue
        if action == "update":
            if loop_guard(gh, repo, pr, why):
                update_and_recheck(gh, repo, pr, why)
            continue
        try:
            title, message = squash_message(pr)
            merged = gh.call("PUT", "/repos/%s/pulls/%d/merge" % (repo, pr["number"]),
                    {"merge_method": "squash", "sha": sha, "commit_title": title, "commit_message": message})
        except urllib.error.HTTPError as e:
            comment_once(gh, repo, pr, "merge-refused", "Not merged (merge-when-green): GitHub refused the merge (HTTP %d)." % e.code)
            continue
        gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, pr["number"]),
                {"body": "Merged by merge-when-green: every PR check green on %s and the merge clean." % sha[:12]})
        print("merged #%d" % pr["number"])
        # the push by the job token starts nothing on main: start what it would have, on the merged range
        head = (merged or {}).get("sha")
        base = None
        if head:
            parents = (gh.call("GET", "/repos/%s/commits/%s" % (repo, head)) or {}).get("parents") or []
            base = parents[0]["sha"] if parents else None
        if workflows is None:
            workflows = load_workflows(root)
        for wf in [FULL_SUITE] + push_followups(workflows, files):
            ok, why = dispatchable(workflows.get(wf) or {})
            if not ok:
                print("::warning::%s would have run on this push but cannot be started by hand (%s)" % (wf, why))
                continue
            inputs = inputs_for(wf, files, base, head)
            if inputs is None:
                print("%s: not started (no pages to send, a template change the weekly run covers, or no merged range)" % wf)
                continue
            declared = set(((workflows.get(wf) or {}).get("workflow_dispatch") or {}).get("inputs") or {})
            if set(inputs) - declared:
                print("::warning::%s does not take the input(s) %s; not started" % (wf, ", ".join(sorted(set(inputs) - declared))))
                continue
            try:
                gh.call("POST", "/repos/%s/actions/workflows/%s/dispatches" % (repo, wf), dict({"ref": "main"}, **({"inputs": inputs} if inputs else {})))
                print("started %s on main" % wf)
            except urllib.error.HTTPError as e:
                print("::warning::could not start %s (HTTP %d)" % (wf, e.code))
    return 0


def git_changed(base, root):
    """-> (files, commits): files that differ between base and main, by git (a shallow fetch of both commits,
    then a tree diff: no 300-file cap), and main's own commits since base, [(meta, files)] along main's first
    parents (a merge counts as one commit: what it brought in). files None: git cannot fetch or diff them.
    commits None: the history back to base cannot be read (base is not on main's first-parent line, or the
    fetch fell short), so the caller counts every change."""
    import subprocess
    g = lambda *a: subprocess.run(["git", "-C", root] + list(a), capture_output=True, text=True)
    if g("fetch", "-q", "--no-tags", "--depth=1", "origin", base, "+refs/heads/main:refs/remotes/origin/main").returncode != 0:
        return None, None
    r = g("diff", "--name-only", "--no-renames", base, "refs/remotes/origin/main")
    if r.returncode != 0:
        return None, None
    files = [l for l in r.stdout.splitlines() if l]
    return files, main_commits(g, base)


HISTORY_MARGIN_S = 3600     # fetch main's history from this long before the base's commit time


def main_commits(g, base):
    when = g("show", "-s", "--format=%ct", base)
    if when.returncode != 0 or not when.stdout.strip().isdigit():
        return None
    since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(int(when.stdout.strip()) - HISTORY_MARGIN_S))
    g("fetch", "-q", "--no-tags", "--shallow-since=" + since, "origin", "+refs/heads/main:refs/remotes/origin/main")
    line = g("rev-list", "--first-parent", "--parents", base + "..refs/remotes/origin/main")
    if line.returncode != 0:
        return None
    rows = [l.split() for l in line.stdout.splitlines() if l.strip()]
    if rows and (len(rows[-1]) < 2 or rows[-1][1] != base):
        return None     # the line does not reach base: base is not main as it was, or the history is cut short
    log = g("log", "--first-parent", "--diff-merges=first-parent", "--name-only", "--no-renames",
            "--format=%x00%H %P%x01%ae%x01%ce%x01%s", base + "..refs/remotes/origin/main")
    if log.returncode != 0:
        return None
    out = parse_log(log.stdout)
    return out if len(out) == len(rows) else None


def parse_log(text):
    """git log --format=%x00%H %P%x01%ae%x01%ce%x01%s --name-only -> [(meta, files)]"""
    out = []
    for chunk in text.split("\0")[1:]:
        head, _, rest = chunk.partition("\n")
        ids, author, committer, subject = (head.split("\x01") + ["", "", ""])[:4]
        out.append(({"sha": ids.split(" ")[0], "parents": len(ids.split()) - 1, "author": author,
                     "committer": committer, "subject": subject}, [l for l in rest.splitlines() if l.strip()]))
    return out


def relevant_to(files, root):
    """scripts/generated_sets.py relevant() for these files, plus the code of every set they touch (another
    merge that changes a module the PR's builder imports changes what its checks built); only the files
    themselves without it"""
    sys.path.insert(0, os.path.join(root, "scripts"))
    try:
        import generated_sets as G
        rel = G.relevant(files, root=root)
        hit, code = set(G.touched(G.SETS, files, root)), set()
        for s in G.SETS:
            if s["id"] in hit:
                code.update(G.code_paths(s, root))
        return lambda f: f in code or rel(f)
    except ImportError:
        return set(files).__contains__
    finally:
        sys.path.pop(0)


def checks_stale(gh, repo, run, head_sha, files, root):
    """stale() of main since the base the run checked: main when a pull_request run started (GitHub
    tests the merge with main as it was), the branch's merge base for a run on the branch itself"""
    try:
        if run.get("event") == "pull_request":
            base = (gh.call("GET", "/repos/%s/commits?sha=main&until=%s&per_page=1" % (repo, run["created_at"])) or [{}])[0].get("sha")
        else:
            base = ((gh.call("GET", "/repos/%s/compare/main...%s" % (repo, head_sha)) or {}).get("merge_base_commit") or {}).get("sha")
    except urllib.error.HTTPError as e:
        return "the checks' base could not be found (HTTP %d)" % e.code
    if not base:
        return "the base the checks ran on cannot be found"
    main_files, commits = git_changed(base, root)
    return stale(files, main_files, relevant_to(files, root), None if commits is None else others_of(commits))


MAX_UPDATES = 3             # updates from main for one reason before the bot stops and says so
UPDATED = re.compile(r"<!-- merge-when-green:[0-9a-f]{12}:(updated(?:-[a-z0-9-]*)?) -->")


def reason_key(why):
    """the kind of a stale reason, without its counts and file names: one loop is one kind"""
    w = re.sub(r"\(.*", "", why.split(": ", 1)[-1])
    return re.sub(r"[^a-z]+", "-", re.sub(r"\d+", "", w).lower()).strip("-")[:40]


def loop_state(comments, since, key):
    """-> (how many times the bot updated the branch for this kind of reason since the label was last
    added, whether it already said it stopped). comments: the pull request's comments from the API."""
    n, said = 0, False
    for c in comments:
        if (c.get("user") or {}).get("login") != BOT or (since and (c.get("created_at") or "") < since):
            continue
        body = c.get("body") or ""
        m = UPDATED.search(body)
        if m and m.group(1) in ("updated", "updated-" + key):
            n += 1
        if MARK % ("loop", "cap-" + key) in body:
            said = True
    return n, said


def loop_guard(gh, repo, pr, why):
    """True: go on and update. False: the bot already updated the branch MAX_UPDATES times for this kind of
    reason and the checks went stale again each time (Nov 4: #308 looped for over an hour); it says so once and
    stops until someone removes the label and adds it again."""
    key = reason_key(why)
    try:
        events = gh.all("/repos/%s/issues/%d/events" % (repo, pr["number"]))
        since = max([e.get("created_at") or "" for e in events
                     if e.get("event") == "labeled" and (e.get("label") or {}).get("name") == LABEL] or [""])
        comments = gh.all("/repos/%s/issues/%d/comments" % (repo, pr["number"]))
    except urllib.error.HTTPError as e:
        print("#%d: cannot read its comments (HTTP %d); not updating this pass" % (pr["number"], e.code))
        return False
    n, said = loop_state(comments, since, key)
    if n < MAX_UPDATES:
        return True
    print("#%d: updated from main %d times for the same reason; stopped (%s)" % (pr["number"], n, why))
    if not said:
        gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, pr["number"]), {"body": (
            "Not merged (merge-when-green): %s. The bot updated the branch from main %d times for this and the checks "
            "were stale again each time, so it has stopped updating it. Merge by hand after a look, or remove the "
            "label and add it again to give it %d more tries. %s") % (why, n, MAX_UPDATES, MARK % ("loop", "cap-" + key))})
    return False


def update_and_recheck(gh, repo, pr, why):
    """bring main into the branch, wait for the new head, and start the full PR checks on it; the merge
    waits for that run. If the head has not moved in RECHECK_WAIT_S, nothing is started now: the next
    pass finds the new head without a run and starts one (start_missing_run)."""
    sha = pr["head"]["sha"]
    try:
        gh.call("PUT", "/repos/%s/pulls/%d/update-branch" % (repo, pr["number"]), {"expected_head_sha": sha})
    except urllib.error.HTTPError as e:
        if e.code == 422:
            msg = ("%s; GitHub cannot update the branch from main by itself (a conflict, or the head moved). Merge main "
                   "into the branch and push." % why)
        else:
            msg = ("%s; GitHub refused to update the branch (HTTP %d: main changed workflow files, which the job token "
                   "may not push). Merge main into the branch and push." % (why, e.code))
        comment_once(gh, repo, pr, "update-refused-%d" % e.code, "Not merged (merge-when-green): " + msg)
        return
    # said (and counted by loop_guard) as soon as GitHub takes the update, whether or not the new head shows here
    comment_once(gh, repo, pr, "updated-" + reason_key(why), "Not merged yet (merge-when-green): %s. Updated the branch "
                 "from main; the PR checks run again on the new head, and it merges when they are green." % why)
    head, end = sha, time.time() + RECHECK_WAIT_S
    while time.time() < end:
        time.sleep(10)
        head = ((gh.call("GET", "/repos/%s/pulls/%d" % (repo, pr["number"])) or {}).get("head") or {}).get("sha", sha)
        if head != sha:
            break
    if head == sha:
        print("#%d: the update has not landed after %d s; the next pass starts the checks on the new head" % (pr["number"], RECHECK_WAIT_S))
        return
    dispatch_checks(gh, repo, pr["head"]["ref"])
    print("#%d: updated from main (%s), pr-checks started on %s" % (pr["number"], why, head[:12]))


def dispatch_checks(gh, repo, ref):
    try:
        gh.call("POST", "/repos/%s/actions/workflows/pr-checks.yml/dispatches" % repo, {"ref": ref, "inputs": {"pick_base": ""}})
        return True
    except urllib.error.HTTPError as e:
        print("::warning::could not start pr-checks on %s (HTTP %d)" % (ref, e.code))
        return False


def needs_run(all_runs, head_age_s):
    """a labeled head with no pr-checks run of any kind, settled long enough that a push's own run would
    have started: start one (a head the bot's update made gets no pull_request run)"""
    return not all_runs and head_age_s is not None and head_age_s >= HEAD_SETTLE_S


def selftest():
    repo = "o/r"
    green = [{"name": n, "status": "completed", "conclusion": "success"} for n in REQUIRED]
    pr = {"state": "open", "labels": [{"name": LABEL}], "head": {"repo": {"full_name": repo}, "sha": "a" * 40},
          "mergeable_state": "clean", "mergeable": True, "draft": False, "number": 1}
    assert decide(pr, repo, green)[0] == "merge"
    assert decide(pr, repo, [dict(j, name="checks / " + j["name"]) for j in green])[0] == "merge", "called-workflow job names"
    assert decide(dict(pr, labels=[]), repo, green)[0] == "wait"
    assert decide(dict(pr, head={"repo": {"full_name": "x/r"}, "sha": "a"}), repo, green)[0] == "no"
    assert decide(dict(pr, head={"repo": None, "sha": "a"}), repo, green)[0] == "no", "a deleted fork"
    red = [dict(j, conclusion="failure") if j["name"] == "node tests (3/8)" else j for j in green]
    assert decide(pr, repo, red) == ("no", "not green: node tests (3/8) failure")
    assert decide(pr, repo, [dict(j, conclusion="skipped") if j["name"] == "guard" else j for j in green])[0] == "no"
    assert decide(pr, repo, [dict(j, status="in_progress", conclusion=None) if j["name"] == "all checks" else j for j in green])[0] == "wait"
    assert decide(pr, repo, green[:-1])[0] == "wait", "a shard not there yet"
    assert decide(pr, repo, [])[0] == "wait"
    for st in ("dirty", "behind", "blocked", "unstable"):
        assert decide(dict(pr, mergeable_state=st), repo, green)[0] == "no", st
    assert decide(dict(pr, mergeable_state="unknown"), repo, green)[0] == "wait"
    assert decide(dict(pr, draft=True), repo, green)[0] == "wait"
    assert decide(dict(pr, state="closed"), repo, green)[0] == "wait"
    wfs = {"sitemap.yml": {"push": {"branches": ["main"], "paths": ["**.html"]}, "workflow_dispatch": None},
           "share.yml": {"push": {"branches": ["main"], "paths": ["*.html"]}, "workflow_dispatch": None},
           "fx.yml": {"push": {"branches": ["fx/x"]}, "workflow_dispatch": None},
           "data.yml": {"push": {"paths-ignore": ["data/**"]}},
           FULL_SUITE: {"push": {"branches": ["main"]}},
           "pr.yml": {"pull_request": None}}
    assert push_followups(wfs, ["cash-bids/iowa/ames.html"]) == ["data.yml", "sitemap.yml"]
    assert push_followups(wfs, ["milk-prices.html"]) == ["data.yml", "share.yml", "sitemap.yml"]
    assert push_followups(wfs, ["data/x.json"]) == []
    assert matches(["data/**", "!data/keep.json"], "data/a/b.json") and not matches(["data/**", "!data/keep.json"], "data/keep.json")
    assert dispatchable({"workflow_dispatch": {"inputs": {"x": {"required": True}}}})[0] is False
    assert dispatchable({"workflow_dispatch": {"inputs": {"x": {"required": True, "default": ""}}}})[0] is True
    assert dispatchable({"push": {}})[0] is False
    assert inputs_for("feeds-guard.yml", ["a.html"]) == {}
    assert inputs_for("indexnow.yml", ["milk-prices.html", "rain/iowa/index.html", "data/x.json"]) == {"urls": "https://agsist.com/milk-prices,https://agsist.com/rain/iowa/"}
    assert inputs_for("indexnow.yml", ["data/x.json"]) is None
    assert inputs_for("indexnow.yml", ["p%d.html" % i for i in range(INDEXNOW_MAX + 1)]) is None
    assert decide(pr, repo, green, ["milk-prices.html"])[0] == "merge"
    act, why = decide(pr, repo, green, ["milk-prices.html", ".github/workflows/x.yml"])
    assert act == "no" and why.startswith("merge by hand: touches workflows"), why
    assert decide(pr, repo, red, [".github/workflows/x.yml"])[1].startswith("not green"), "red says red first"
    assert decide(pr, repo, green, [".github/actions/engine/action.yml"])[0] == "merge", "only workflow files"
    b, h = "b" * 40, "c" * 40
    assert inputs_for("preship.yml", ["a.html"], b, h) == {"base": b, "head": h}
    assert inputs_for("sitemap.yml", ["a.html"], b, h) == {"base": b, "head": h}
    assert inputs_for("sitemap.yml", ["a.html"]) is None, "no merged range: not started on a wrong one"
    assert inputs_for("preship.yml", ["a.html"], "HEAD~1", h) is None
    # no merge on stale checks (Nov 4, 2026; build rule 60: #280, #282)
    assert decide(pr, repo, green, ["a.html"], "another merge landed on main since (abc)") == \
        ("update", "the checks ran against an older main: another merge landed on main since (abc)")
    assert decide(pr, repo, red, ["a.html"], "x")[0] == "no", "red stays red, stale or not"
    assert decide(pr, repo, green, [".github/workflows/x.yml"], "x")[0] == "no", "workflow changes are merged by hand"
    bot = ["data/bids.json"] + ["cash-bids/st%d/t%d.html" % (k // 100, k) for k in range(2900)]
    assert stale(["scripts/x.py", "test/x.test.mjs"], bot) is None, "a 2,900-file bot commit touching nothing relevant: fresh"
    assert stale(["cash-bids/st1/t150.html", "scripts/x.py"], bot).startswith("main changed 1 file(s) this pull request's checks read"), \
        "main rebuilt a page the pull request carries (#282): stale"
    assert stale(["scripts/x.py"], ["scripts/y.py", "components/z.js", "test/y.test.mjs"]) is None, "another PR's merge that does not overlap: fresh"
    assert stale(["scripts/x.py"], ["scripts/x.py"]).startswith("main changed 1 file"), "another PR's merge that overlaps: stale"
    rel = lambda f: f.startswith("rain/") or f == "scripts/build_county_rain.py"
    assert stale(["scripts/build_county_rain.py"], ["rain/iowa/x.html"], rel), "main moved the set the PR's builder writes (#280): stale"
    assert stale(["a"], None).startswith("main's changes"), "unreadable: stale, never a blind merge"
    assert stale(["a"], []) is None
    assert needs_run([], HEAD_SETTLE_S) and not needs_run([], 10) and not needs_run([{"id": 1}], 999) and not needs_run([], None)
    runs = [{"event": "pull_request", "created_at": "2026-11-04T10:00:00Z", "id": 1},
            {"event": "workflow_dispatch", "created_at": "2026-11-04T11:00:00Z", "id": 2, "head_branch": "fx/a",
             "triggering_actor": {"login": BOT}},
            {"event": "workflow_dispatch", "created_at": "2026-11-04T12:00:00Z", "id": 3, "head_branch": "fx/a",
             "triggering_actor": {"login": "someone"}}]
    assert pick_run(runs, "fx/a")["id"] == 2, "the bot's own full run on the branch counts; a replay by hand does not"
    assert pick_run(runs, "fx/b")["id"] == 1 and pick_run([], "fx/a") is None
    # Nov 4, 2026, #308: a builder PR never merged, since the bids bot rewrites its set every 15 minutes
    real = ["scripts/build_cash_bid_pages.py", "test/cash-bid-pages.test.mjs"]
    rel308 = lambda f: f in real or f.startswith("cash-bids/") or f in ("cash-bids.html", "data/bids.json")
    town = ["cash-bids.html"] + ["cash-bids/alabama/t%d.html" % k for k in range(1824)]
    botc = {"sha": "1b2efb89da7", "parents": 1, "author": "bot@agsist.com", "committer": "bot@agsist.com",
            "subject": "pages: rebuild /cash-bids town pages from the elevator network 2026-11-04"}
    assert data_bot_commit(botc)
    assert stale(real, town, rel308).startswith("main changed 1825 file(s)"), "no commit split: every change counts, as before"
    assert stale(real, town, rel308, others_of([(botc, town)])) is None, "#308: a 1,825-file bot data commit leaves a builder PR fresh"
    merge = {"sha": "9096bb4fa61", "parents": 2, "author": "41898282+github-actions[bot]@users.noreply.github.com",
             "committer": "noreply@github.com", "subject": "Merge pull request #307 from dnilgis:fx/wave1a"}
    assert not data_bot_commit(merge), "the merge bot shares the data bot's name; two parents and GitHub as committer"
    assert stale(real, town, rel308, others_of([(botc, town), (merge, ["cash-bids/alabama/t3.html", "x.js"])])) \
        .startswith("main changed 1 file(s)"), "another PR's merge touching the set: stale"
    squash = dict(botc, author="123344677+dnilgis@users.noreply.github.com", committer="noreply@github.com",
                  subject="Site panel fixes, batch 2 (#308)")
    assert not data_bot_commit(squash), "a squash merge"
    assert not data_bot_commit(dict(botc, subject="Bids fix (#311)")), "the bot's address with a PR suffix counts"
    assert not data_bot_commit(dict(botc, committer="noreply@github.com")), "GitHub committed it: a merge through GitHub"
    assert not data_bot_commit(dict(botc, author="dnilgis@users.noreply.github.com")), "a hand push"
    assert not data_bot_commit(dict(botc, author="sig@agsist.com", committer="sig@agsist.com")), "Sig's own address"
    assert not data_bot_commit(dict(botc, parents=2, subject="Merge branch 'main'")), "a merge, whoever made it"
    assert stale(real, town + ["scripts/build_cash_bid_pages.py"], rel308, []).startswith("main changed 1 file"), \
        "main changed the PR's own file, even by the bot: stale"
    assert stale(real, town + [".github/workflows/fetch-bids.yml"], rel308, []).startswith("main changed 1 workflow file"), \
        "main changed a workflow: stale"
    assert stale(real, None, rel308, []).startswith("main's changes"), "unreadable: stale"
    assert stale(["scripts/x.py"], ["scripts/x.py"], None, []) and stale(["a"], ["b"], None, ["b"]) is None
    log = ("\0aaa ppp\x01bot@agsist.com\x01bot@agsist.com\x01Update grain bids\n\ndata/bids.json\ncash-bids/a.html\n"
           "\0mmm ppp qqq\x0141898282+github-actions[bot]@users.noreply.github.com\x01noreply@github.com\x01Merge pull request #1\n\nx.js\n")
    pl = parse_log(log)
    assert [m["parents"] for m, _ in pl] == [1, 2] and pl[0][1] == ["data/bids.json", "cash-bids/a.html"] and pl[1][1] == ["x.js"]
    assert others_of(pl) == ["x.js"]
    git_fixture()
    # the bot stops after MAX_UPDATES updates for one kind of reason (#308 looped for over an hour)
    why = "the checks ran against an older main: " + stale(real, town, rel308)
    k = reason_key(why)
    assert k == reason_key("the checks ran against an older main: main changed 7 file(s) this pull request's checks read since (a)")
    assert k != reason_key("the checks ran against an older main: main changed 1 workflow file(s) since (x)")
    upd = lambda sha, at, key=k, who=BOT: {"user": {"login": who}, "created_at": at, "body": "Not merged yet. " + MARK % (sha * 12, "updated-" + key)}
    cs = [upd("a", "2026-11-04T08:20:00Z"), upd("b", "2026-11-04T08:45:00Z"), upd("c", "2026-11-04T09:10:00Z")]
    assert loop_state(cs[:2], "", k) == (2, False) and loop_state(cs, "", k) == (3, False)
    assert loop_state(cs, "2026-11-04T08:30:00Z", k)[0] == 2, "only since the label was last added"
    assert loop_state([upd("a", "2026-11-04T08:20:00Z", "other")] * 5, "", k)[0] == 0, "another kind of reason"
    assert loop_state([upd("a", "2026-11-04T08:20:00Z", who="dnilgis")] * 5, "", k)[0] == 0, "only the bot's own"
    legacy = {"user": {"login": BOT}, "created_at": "2026-11-04T08:00:00Z", "body": MARK % ("d" * 12, "updated")}
    assert loop_state([legacy], "", k)[0] == 1, "the comments from before this change count"
    capc = {"user": {"login": BOT}, "created_at": "2026-11-04T09:30:00Z", "body": "stopped " + MARK % ("loop", "cap-" + k)}
    assert loop_state(cs + [capc], "", k) == (3, True)
    assert loop_state(cs + [capc], "2026-11-04T09:40:00Z", k) == (0, False), "label added again: three more tries"
    # loop_guard() itself, on a fake GitHub
    class FakeGH:
        def __init__(self, comments, events=(), broken=False):
            self.comments, self.events, self.broken, self.posted = list(comments), list(events), broken, []

        def all(self, path):
            if self.broken:
                raise urllib.error.HTTPError(path, 502, "bad gateway", None, None)
            return self.events if path.endswith("/events") else self.comments

        def call(self, method, path, body=None):
            assert method == "POST" and path.endswith("/comments"), (method, path)
            self.posted.append(body["body"])
            self.comments.append({"user": {"login": BOT}, "created_at": "2026-11-04T09:30:00Z", "body": body["body"]})
    labeled = [{"event": "labeled", "label": {"name": LABEL}, "created_at": "2026-11-04T08:00:00Z"}]
    f = FakeGH(cs, labeled)
    assert loop_guard(f, repo, pr, why) is False and len(f.posted) == 1, "three updates: stop and say so"
    assert MARK % ("loop", "cap-" + k) in f.posted[0]
    assert loop_guard(f, repo, pr, why) is False and len(f.posted) == 1, "said once, not again"
    f = FakeGH(cs[:2], labeled)
    assert loop_guard(f, repo, pr, why) is True and f.posted == [], "two updates: go on"
    f = FakeGH(cs, labeled, broken=True)
    assert loop_guard(f, repo, pr, why) is False and f.posted == [], "comments unreadable: no update this pass"
    relabel = labeled + [{"event": "labeled", "label": {"name": LABEL}, "created_at": "2026-11-04T09:40:00Z"},
                         {"event": "labeled", "label": {"name": "other"}, "created_at": "2026-11-04T10:00:00Z"}]
    f = FakeGH(cs + [capc], relabel)
    assert loop_guard(f, repo, pr, why) is True and f.posted == [], "label added again later: the count resets"
    # the squash message: the body only, footer stripped; the commits' Co-Authored-By lines never reach it (#304)
    body = ("Gift cards: store prepaid on every card.\r\n\r\nTests: 30 pass.\r\n\r\n---\r\n"
            "_Generated by [Claude Code](https://claude.ai/code/session_0125s99DeDZ8Mo1rchb65eNW)_")
    sq = dict(pr, number=304, title="Pull-rebase without identity ", body=body,
              commits=[{"commit": {"message": "x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n"
                                              "Claude-Session: https://claude.ai/code/session_0125s99DeDZ8Mo1rchb65eNW"}}])
    title, message = squash_message(sq)
    assert title == "Pull-rebase without identity (#304)", title
    assert message == "Gift cards: store prepaid on every card.\n\nTests: 30 pass.", repr(message)
    assert not re.search(r"(?i)claude|co-authored|generated", title + message), message
    assert squash_message(dict(pr, title="T", body=None)) == ("T (#1)", "")
    assert squash_message(dict(pr, title="T (#1)", body=None))[0] == "T (#1)", "no doubled suffix"
    assert squash_message(dict(pr, title="Follow-up to (#12)", body=None))[0] == "Follow-up to (#12) (#1)", "another PR's number is not its own"
    # the merge call itself: a squash with that title and message, never a merge commit or GitHub's default body
    src = open(os.path.abspath(__file__), encoding="utf-8").read()
    put = src[src.index("title, message = squash_message(pr)\n"):src.index("except urllib.error.HTTPError as e:\n            comment_once")]
    for want in ('"merge_method": "squash"', '"commit_title": title', '"commit_message": message'):
        assert want in put, (want, put)
    assert ('"merge_method": "' + 'merge"') not in src and "commits" not in put
    print("merge_when_green selftest passed")
    return 0


def git_fixture():
    """git_changed() on a real repository: a shallow clone of main as the job has it, the base three commits back"""
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        o, c = os.path.join(d, "origin"), os.path.join(d, "clone")
        env0 = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")

        def git(cwd, *a, who=("dnilgis", "dnilgis@users.noreply.github.com"), at=None, by=None):
            env = dict(env0, GIT_AUTHOR_NAME=who[0], GIT_AUTHOR_EMAIL=who[1], GIT_COMMITTER_NAME=(by or who)[0],
                       GIT_COMMITTER_EMAIL=(by or who)[1])
            if at:
                env.update(GIT_AUTHOR_DATE=at, GIT_COMMITTER_DATE=at)
            r = subprocess.run(["git", "-C", cwd] + list(a), capture_output=True, text=True, env=env)
            assert r.returncode == 0, (a, r.stderr)
            return r.stdout.strip()

        def put(path, text):
            os.makedirs(os.path.dirname(os.path.join(o, path)) or o, exist_ok=True)
            open(os.path.join(o, path), "w").write(text)
        bot = ("AGSIST Bot", "bot@agsist.com")
        os.makedirs(o)
        git(o, "init", "-q", "-b", "main")
        for f in ["scripts/build.py", "cash-bids/a.html", "x.js"]:
            put(f, "0")
        git(o, "add", "-A")
        git(o, "commit", "-qm", "start", at="2026-11-04T06:00:00Z")
        put("x.js", "1")
        git(o, "commit", "-qam", "older", at="2026-11-04T07:00:00Z")
        base = git(o, "rev-parse", "HEAD")
        put("cash-bids/a.html", "1")
        git(o, "commit", "-qam", "pages: rebuild", who=bot, at="2026-11-04T08:00:00Z")
        git(o, "checkout", "-qb", "fx/other", at="2026-11-04T08:01:00Z")
        put("x.js", "2")
        git(o, "commit", "-qam", "other change", at="2026-11-04T08:02:00Z")
        git(o, "checkout", "-q", "main")
        git(o, "merge", "-q", "--no-ff", "-m", "Merge pull request #2 from o:fx/other", "fx/other",
            who=("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com"),
            by=("GitHub", "noreply@github.com"), at="2026-11-04T08:30:00Z")
        put("cash-bids/a.html", "2")
        git(o, "commit", "-qam", "Update grain bids", who=bot, at="2026-11-04T08:45:00Z")
        git(d, "clone", "-q", "--depth=1", "--no-local", "file://" + o, c)
        files, commits = git_changed(base, c)
        assert files == ["cash-bids/a.html", "x.js"], files
        assert [m["subject"] for m, _ in commits] == ["Update grain bids", "Merge pull request #2 from o:fx/other", "pages: rebuild"], commits
        assert others_of(commits) == ["x.js"], "the merge brought x.js; the bot's two commits only the page"
        assert stale(["scripts/build.py"], files, lambda f: f.startswith("cash-bids/"), others_of(commits)) is None
        files2, commits2 = git_changed(git(o, "rev-parse", "fx/other"), c)
        assert files2 is not None and commits2 is None, "a base off main's first-parent line: every change counts"
        assert git_changed("f" * 40, c) == (None, None), "a base that is not there: unreadable"


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
