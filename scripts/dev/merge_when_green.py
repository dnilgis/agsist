#!/usr/bin/env python3
"""Merge a pull request labeled "merge-when-green" once its PR checks are green (Sig, Oct 29, 2026).

GitHub's own auto-merge needs required checks on main, which would stop the data jobs that commit
straight to main, so .github/workflows/merge-when-green.yml does it instead. For every open pull
request with the label it merges (a merge commit, through the API, with the job token) only when:
  - the branch is in this repository (never a fork) and the pull request is not a draft;
  - the newest pr-checks run for the head commit has every job finished and green: guard, other
    checks, each node test shard and all checks;
  - GitHub says the merge is clean (mergeable_state "clean": no conflict, nothing else red).
Red, pending, conflicted or behind: no merge. A red or conflicted head gets one comment saying why
(once per head commit and reason); a pending one waits for the next pr-checks run to finish.

A merge by the job token starts no push run on main, so after a merge this starts main-checks.yml
by hand, and every workflow that would have run on that push (push to main, its paths matching the
merged files, workflow_dispatch on) the same way.

  python3 scripts/dev/merge_when_green.py              (in merge-when-green.yml)
  python3 scripts/dev/merge_when_green.py --selftest
"""
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

LABEL = "merge-when-green"
API = "https://api.github.com"
MARK = "<!-- merge-when-green:%s:%s -->"
SHARDS = 8
REQUIRED = ["guard", "other checks", "all checks"] + ["node tests (%d/%d)" % (i, SHARDS) for i in range(1, SHARDS + 1)]
FULL_SUITE = "main-checks.yml"


WORKFLOW_DIR = ".github/workflows/"


def decide(pr, repo, jobs, files=()):
    """-> (action, reason): action 'merge', 'wait' (say nothing yet) or 'no' (say why, once).
    pr: the pull request object from the API; jobs: the jobs of the newest pr-checks run for its
    head commit ([] when there is none); files: the paths the pull request changes."""
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
    return "merge", "every PR check green and the merge is clean"


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
        runs = gh.call("GET", "/repos/%s/actions/workflows/pr-checks.yml/runs?event=pull_request&head_sha=%s&per_page=10" % (repo, sha)) or {}
        runs = sorted(runs.get("workflow_runs", []), key=lambda r: r.get("run_number", 0), reverse=True)
        jobs = gh.all("/repos/%s/actions/runs/%d/jobs" % (repo, runs[0]["id"])) if runs else []
        files = [f["filename"] for f in gh.all("/repos/%s/pulls/%d/files" % (repo, pr["number"]))]
        action, why = decide(pr, repo, jobs, files)
        print("#%d %s: %s (%s)" % (pr["number"], sha[:12], action, why))
        if action == "wait":
            continue
        if action == "no":
            key = re.sub(r"[^a-z]+", "-", why.split(":")[0].lower()).strip("-")[:40]
            comment_once(gh, repo, pr, key, "Not merged (merge-when-green): %s." % why)
            continue
        try:
            merged = gh.call("PUT", "/repos/%s/pulls/%d/merge" % (repo, pr["number"]),
                    {"merge_method": "merge", "sha": sha,
                     "commit_title": "Merge pull request #%d from %s" % (pr["number"], pr["head"]["label"])})
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
    print("merge_when_green selftest passed")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
