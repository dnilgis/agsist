#!/usr/bin/env python3
"""The "main is red" issue for main-checks.yml: seen, not silent.

A red full-suite run on main opens one issue titled "main is red: <first failing test>" (with
"and N more" when there are more), or, when one is open already, retitles it and adds a comment.
The body and comment name the failing checks and tests and link the run. A green run closes the
open issue with a note. A cancelled run (a newer push took over) changes nothing.

Environment: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL (Actions sets the last
three), REBUILD and CHECKS (the needs.<job>.result values), SHA (the commit checked).

  python3 scripts/dev/main_red.py              (in main-checks.yml)
  python3 scripts/dev/main_red.py --selftest
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request

LABEL = "main-is-red"
API = "https://api.github.com"


def parse_failures(log):
    """failing names from a job log: checks.sh's 'FAIL <check>' lines and node's 'not ok N - <test>'"""
    checks, tests = [], []
    for line in log.splitlines():
        line = re.sub(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ", "", line).rstrip()
        m = re.match(r"^FAIL ([\w.-]+)\b", line)
        if m and m.group(1) not in checks:
            checks.append(m.group(1))
        m = re.match(r"^\s*not ok \d+ - (.+?)(?: # .*)?$", line)
        if m:
            name = m.group(1).strip()[:150]
            if name not in tests:
                tests.append(name)
    return checks, tests


def title_for(names):
    if not names:
        return "main is red: the full suite failed"
    t = "main is red: " + names[0]
    if len(names) > 1:
        t += " (and %d more)" % (len(names) - 1)
    return t[:240]


def decide(rebuild, checks, open_issue):
    """-> 'red' (open or update the issue), 'close' (green again), or 'none'"""
    if rebuild == "failure" or checks == "failure":
        return "red"
    if rebuild == "success" and checks == "success":
        return "close" if open_issue else "none"
    return "none"   # cancelled or skipped: a newer run took over


class GH:
    def __init__(self, token, repo):
        self.token, self.repo = token, repo

    def call(self, method, path, body=None, raw=False):
        url = path if path.startswith("http") else API + path
        req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        if raw:
            return data.decode("utf-8", "replace")
        return json.loads(data) if data else None

    def job_log(self, job_id):
        """the log is a redirect to a signed URL; follow it without the token"""
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        req = urllib.request.Request("%s/repos/%s/actions/jobs/%d/logs" % (API, self.repo, job_id))
        req.add_header("Authorization", "Bearer " + self.token)
        try:
            urllib.request.build_opener(NoRedirect).open(req, timeout=60)
            return ""
        except urllib.error.HTTPError as e:
            loc = e.headers.get("Location") if e.code in (301, 302, 303, 307, 308) else None
            if not loc:
                return ""
        with urllib.request.urlopen(loc, timeout=120) as r:
            return r.read().decode("utf-8", "replace")


def main():
    token, repo = os.environ.get("GH_TOKEN", ""), os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_url = "%s/%s/actions/runs/%s" % (os.environ.get("GITHUB_SERVER_URL", "https://github.com"), repo, run_id)
    rebuild, checks, sha = os.environ.get("REBUILD", ""), os.environ.get("CHECKS", ""), os.environ.get("SHA", "")[:12]
    gh = GH(token, repo)
    issues = gh.call("GET", "/repos/%s/issues?state=open&labels=%s&per_page=20" % (repo, LABEL)) or []
    issue = next((i for i in issues if i.get("title", "").startswith("main is red") and "pull_request" not in i), None)
    what = decide(rebuild, checks, issue)
    print("rebuild: %s, checks: %s, open issue: %s -> %s" % (rebuild, checks, issue and issue["number"], what))
    if what == "none":
        return 0
    if what == "close":
        gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, issue["number"]),
                {"body": "Green again on %s: every test passed (%s). Closing." % (sha, run_url)})
        gh.call("PATCH", "/repos/%s/issues/%d" % (repo, issue["number"]), {"state": "closed", "state_reason": "completed"})
        return 0
    failed_checks, failed_tests, jobs = [], [], []
    page = 1
    while True:
        r = gh.call("GET", "/repos/%s/actions/runs/%s/jobs?per_page=100&page=%d" % (repo, run_id, page)) or {}
        jobs += r.get("jobs", [])
        if len(r.get("jobs", [])) < 100:
            break
        page += 1
    red_jobs = [j for j in jobs if j.get("conclusion") == "failure"]
    for j in red_jobs:
        try:
            c, t = parse_failures(gh.job_log(j["id"]))
        except (urllib.error.URLError, OSError) as e:
            print("could not read the log of %s: %s" % (j.get("name"), e))
            c, t = [], []
        failed_checks += [x for x in c if x not in failed_checks]
        failed_tests += [x for x in t if x not in failed_tests]
    if rebuild == "failure":
        failed_checks.insert(0, "rebuild of the built files")
    names = failed_tests or failed_checks or [j["name"] for j in red_jobs]
    title = title_for(names)
    lines = ["Full suite on main, commit %s: %s" % (sha or "(none)", run_url), ""]
    if red_jobs:
        lines.append("Red jobs: " + ", ".join(j["name"] for j in red_jobs))
    if failed_checks:
        lines.append("Failed checks: " + ", ".join(failed_checks))
    if failed_tests:
        lines.append("Failed tests:")
        lines += ["- " + t for t in failed_tests[:30]]
    body = "\n".join(lines)
    try:
        gh.call("POST", "/repos/%s/labels" % repo, {"name": LABEL, "color": "b60205", "description": "the full suite on main failed"})
    except urllib.error.HTTPError as e:
        if e.code != 422:   # 422: the label is there already
            raise
    if issue:
        gh.call("PATCH", "/repos/%s/issues/%d" % (repo, issue["number"]), {"title": title})
        gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, issue["number"]), {"body": body})
        print("updated issue #%d: %s" % (issue["number"], title))
    else:
        r = gh.call("POST", "/repos/%s/issues" % repo, {"title": title, "body": body, "labels": [LABEL]})
        print("opened issue #%d: %s" % (r["number"], title))
    return 0


def selftest():
    log = ("2026-10-29T01:00:00.0000000Z ok   seo\n2026-10-29T01:00:00.1Z FAIL node-test\n"
           "not ok 3 - the milk page shows its area\n    not ok 1 - a nested step\n"
           "not ok 3 - the milk page shows its area\nFAIL budget (python3 x)\nnot ok 9 - skipped one # SKIP no tool\n")
    c, t = parse_failures(log)
    assert c == ["node-test", "budget"], c
    assert t == ["the milk page shows its area", "a nested step", "skipped one"], t
    assert title_for(["a"]) == "main is red: a"
    assert title_for(["a", "b", "c"]) == "main is red: a (and 2 more)"
    assert title_for([]) == "main is red: the full suite failed"
    assert decide("success", "failure", None) == "red"
    assert decide("failure", "skipped", None) == "red"
    assert decide("success", "success", {"number": 1}) == "close"
    assert decide("success", "success", None) == "none"
    assert decide("success", "cancelled", {"number": 1}) == "none"
    print("main_red selftest passed")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
