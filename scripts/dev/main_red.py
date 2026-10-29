#!/usr/bin/env python3
"""The "main is red" issue for main-checks.yml: seen, not silent.

A red full-suite run on main opens one issue titled "main is red: <first failing test>" (with
"and N more" when there are more). When one is open already (found by its label, or by its title
if the label was taken off), a run with a different set of failures retitles it and comments with
the new list; a run with the same failures comments at most once a day ("still red"), so a red
nightly plus every merge does not bury the issue. The body and comments name the failing checks
and tests and link the run. A green run closes the open issue with a note. A cancelled run (a newer
push took over) changes nothing.

Environment: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL (Actions sets the last
three), REBUILD and CHECKS (the needs.<job>.result values), SHA (the commit checked).

  python3 scripts/dev/main_red.py              (in main-checks.yml)
  python3 scripts/dev/main_red.py --selftest
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import _argguard  # scripts/_argguard.py: --help and bad flags exit before any work
_argguard.guard(__file__)
sys.path.pop(0)

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


SET_MARK = "<!-- main-red:set=%s:%s -->"      # failure-set fingerprint, UTC date
STILL_MARK = "<!-- main-red:still=%s:%s -->"
MARK_RE = re.compile(r"<!-- main-red:(set|still)=([0-9a-f]{12}):(\d{4}-\d\d-\d\d) -->")


def fingerprint(names):
    return hashlib.sha1("\n".join(sorted(set(names))).encode("utf-8")).hexdigest()[:12]


def comment_plan(texts, fp, today):
    """texts: the issue body, then its comments, oldest first. -> 'new' (the failures changed: retitle and
    list them), 'still' (the same failures, nothing said yet today) or None (the same, already said today)"""
    last, said_today = None, False
    for t in texts:
        for kind, f, day in MARK_RE.findall(t or ""):
            if kind == "set":
                last = f
            if day == today:
                said_today = True
    if last != fp:
        return "new"
    return None if said_today else "still"


def find_issue(issues):
    """the open "main is red" issue: the labeled one first, else one with the title (a label taken off)"""
    mine = [i for i in issues if "pull_request" not in i and (i.get("title") or "").startswith("main is red")]
    labeled = [i for i in mine if LABEL in {l.get("name") for l in i.get("labels", [])}]
    pick = sorted(labeled or mine, key=lambda i: i.get("number", 0))
    return pick[0] if pick else None


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
    issues = []
    for page in range(1, 6):
        got = gh.call("GET", "/repos/%s/issues?state=open&per_page=100&page=%d" % (repo, page)) or []
        issues += got
        if len(got) < 100:
            break
    issue = find_issue(issues)
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
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    fp = fingerprint(names)
    body = "\n".join(lines) + "\n\n" + SET_MARK % (fp, today)
    try:
        gh.call("POST", "/repos/%s/labels" % repo, {"name": LABEL, "color": "b60205", "description": "the full suite on main failed"})
    except urllib.error.HTTPError as e:
        if e.code != 422:   # 422: the label is there already
            raise
    if issue:
        n = issue["number"]
        if LABEL not in {l.get("name") for l in issue.get("labels", [])}:
            gh.call("POST", "/repos/%s/issues/%d/labels" % (repo, n), {"labels": [LABEL]})
        comments = []
        for page in range(1, 11):
            got = gh.call("GET", "/repos/%s/issues/%d/comments?per_page=100&page=%d" % (repo, n, page)) or []
            comments += got
            if len(got) < 100:
                break
        plan = comment_plan([issue.get("body") or ""] + [c.get("body") or "" for c in comments], fp, today)
        if plan == "new":
            if issue.get("title") != title:
                gh.call("PATCH", "/repos/%s/issues/%d" % (repo, n), {"title": title})
            gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, n), {"body": body})
            print("updated issue #%d, the failures changed: %s" % (n, title))
        elif plan == "still":
            gh.call("POST", "/repos/%s/issues/%d/comments" % (repo, n),
                    {"body": "Still red on %s with the same failures: %s\n\n%s" % (sha or "(none)", run_url, STILL_MARK % (fp, today))})
            print("issue #%d: still red, same failures (one note a day)" % n)
        else:
            print("issue #%d: same failures, already noted today; nothing posted" % n)
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
    fp = fingerprint(["b", "a", "a"])
    assert fp == fingerprint(["a", "b"]) and fp != fingerprint(["a"])
    first = "body " + SET_MARK % (fp, "2026-10-29")
    assert comment_plan([first], fp, "2026-10-29") is None, "the same set, already said today"
    assert comment_plan([first], fp, "2026-10-30") == "still", "the same set, a new day: one note"
    assert comment_plan([first, "x " + STILL_MARK % (fp, "2026-10-30")], fp, "2026-10-30") is None, "one a day"
    assert comment_plan([first], fingerprint(["c"]), "2026-10-29") == "new", "a different set"
    other = fingerprint(["c"])
    assert comment_plan([first, SET_MARK % (other, "2026-10-29")], fp, "2026-10-29") == "new", "back to an earlier set is a change"
    assert comment_plan(["an issue opened by hand"], fp, "2026-10-29") == "new"
    lab = {"name": LABEL}
    iss = [{"number": 9, "title": "main is red: x", "labels": []}, {"number": 12, "title": "main is red: y", "labels": [lab]},
           {"number": 3, "title": "main is red: pr", "pull_request": {}, "labels": [lab]}, {"number": 4, "title": "other", "labels": [lab]}]
    assert find_issue(iss)["number"] == 12, "the labeled one first"
    assert find_issue(iss[:1])["number"] == 9, "by title when the label was taken off"
    assert find_issue(iss[2:]) is None, "never a pull request or another title"
    print("main_red selftest passed")
    return 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else main())
