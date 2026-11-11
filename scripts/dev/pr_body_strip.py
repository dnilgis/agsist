#!/usr/bin/env python3
"""Remove footer lines (ai_footer_check.MARKS) from a pull request body; re-run the guard job when it failed on the footer step.

    python3 scripts/dev/pr_body_strip.py              (pr-body.yml; GH_TOKEN, GITHUB_REPOSITORY, PR, HEAD_SHA)
    python3 scripts/dev/pr_body_strip.py --selftest
"""
import contextlib
import io
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
sys.path[0] = os.path.dirname(os.path.abspath(__file__))
from ai_footer_check import found, strip  # noqa: E402

API = os.environ.get("GITHUB_API_URL", "https://api.github.com")


def call(method, path, token, data=None):
    req = urllib.request.Request(API + path, method=method,
                                 data=None if data is None else json.dumps(data).encode(),
                                 headers={"Authorization": "Bearer " + token,
                                          "Accept": "application/vnd.github+json",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def new_body(body):
    """The body without footer lines, or None when there is nothing to remove."""
    if not found(body or ""):
        return None
    return strip(body)


FOOTER_STEP = "no AI footer in the pull request"  # the guard step in pr-checks.yml that reads the body


def guard_run(repo, sha, token):
    """(run, guard job) for the newest pr-checks run of sha; (None, None) when there is none yet."""
    runs = safe("GET", "/repos/%s/actions/workflows/pr-checks.yml/runs?head_sha=%s&per_page=5" % (repo, sha), token)
    for run in (runs or {}).get("workflow_runs", []):
        jobs = safe("GET", "/repos/%s/actions/runs/%d/jobs?per_page=100" % (repo, run["id"]), token)
        for job in (jobs or {}).get("jobs", []):
            if job.get("name") == "guard":
                return run, job
    return None, None


def footer_step_failed(job):
    """True when the guard job's failed step is the footer step (a red guard for another reason is left alone)."""
    return any(st.get("name") == FOOTER_STEP and st.get("conclusion") == "failure" for st in job.get("steps") or [])


def safe(method, path, token, data=None, ok=None):
    """call(), but a refused or failed request is a note, not a failure (the body fix already happened).
    ok, a list, gets True appended when the request answered."""
    try:
        out = call(method, path, token, data)
        if ok is not None:
            ok.append(True)
        return out
    except Exception as e:  # HTTPError, timeout, bad JSON
        print("note: %s %s did not answer: %s" % (method, path.split("?")[0], str(e)[:80]))
        return None


WAIT, PAUSE = 100, 15  # 25 minutes at most (job timeout 30); the selftest sets PAUSE to 0


def rerun_guard(repo, sha, token):
    """Wait for the guard job of sha. When its footer step failed, wait for the whole run to end (GitHub
    refuses to re-run a job of a run still going), then re-run only the guard job (all-checks follows it)."""
    for _ in range(WAIT):
        run, job = guard_run(repo, sha, token)
        if run and job and job.get("status") == "completed":
            concl = job.get("conclusion")
            if concl == "success":
                print("guard: success")
                return 0
            if not footer_step_failed(job):
                print("guard: %s, not on the footer step; left alone" % concl)
                return 0
            if run.get("status") == "completed":
                ok = []
                safe("POST", "/repos/%s/actions/jobs/%d/rerun" % (repo, job["id"]), token, ok=ok)
                print(("guard re-run started (run %d)" if ok else "guard re-run refused (run %d); re-run it by hand") % run["id"])
                return 0
        time.sleep(PAUSE)
    print("the checks run did not end in time; re-run the guard by hand once it ends")
    return 0


def main():
    repo, n, sha, token = (os.environ.get(k, "") for k in ("GITHUB_REPOSITORY", "PR", "HEAD_SHA", "GH_TOKEN"))
    if not (repo and n and token):
        print("no pull request in this run")
        return 0
    pr = safe("GET", "/repos/%s/pulls/%s" % (repo, n), token)
    if pr is None:
        print("could not read the pull request body")
        return 0
    sha = sha or (pr.get("head") or {}).get("sha", "")
    body = new_body(pr.get("body"))
    if body is not None:
        safe("PATCH", "/repos/%s/pulls/%s" % (repo, n), token, {"body": body})
        after = (safe("GET", "/repos/%s/pulls/%s" % (repo, n), token) or {}).get("body")
        if after is None:
            print("could not read the body back after the edit")
            return 0
        if found(after):
            print("::error::the footer came back after the edit")
            return 1
        print("footer lines removed")
    else:
        print("body has no footer lines")
    # also after a clean body: a run cancelled between the edit and the re-run leaves a red guard behind
    return rerun_guard(repo, sha, token)


def mock_main_selftest():
    """main() against a fake API: strip, verify, re-run a red guard only for the footer step and only once the
    run has ended; a refused re-run is reported as refused; an unread body is reported as unread."""
    global call, PAUSE
    real, fails, PAUSE = call, 0, 0
    F = "Fix.\n\n---\n_Generated by [Claude Code](https://claude.ai/code/x)_"
    # body, guard conclusion, failed step, run statuses seen in turn, refuse POST, refuse GET pulls, calls, line
    for body, guard, step, runs, refuse, noread, want_calls, want_line in [
        (F, "failure", FOOTER_STEP, ["completed"], False, False, ["PATCH", "POST"], "guard re-run started"),
        ("Fix.", "failure", FOOTER_STEP, ["completed"], False, False, ["POST"], "guard re-run started"),
        ("Fix.", "success", None, ["completed"], False, False, [], "guard: success"),
        ("Fix.", "failure", "built files", ["completed"], False, False, [], "not on the footer step"),
        (F, "failure", FOOTER_STEP, ["completed"], True, False, ["PATCH", "POST"], "guard re-run refused"),
        (F, "failure", FOOTER_STEP, ["in_progress", "in_progress", "completed"], False, False, ["PATCH", "POST"], "guard re-run started"),
        (F, "failure", FOOTER_STEP, ["in_progress"] * 5, False, False, ["PATCH"], "did not end in time"),
        (F, "failure", FOOTER_STEP, ["completed"], False, True, [], "could not read the pull request body"),
    ]:
        state, seen = {"body": body, "runs": list(runs)}, []
        def fake(method, path, token, data=None, state=state, seen=seen, guard=guard, step=step, refuse=refuse, noread=noread):
            if method != "GET":
                seen.append(method)
            if method == "POST" and refuse:
                raise OSError("403 forbidden")
            if method == "PATCH":
                state["body"] = data["body"]
            if "/pulls/" in path:
                if noread:
                    raise OSError("502")
                return {"body": state["body"], "head": {"sha": "abc"}}
            if "/workflows/" in path:
                st = state["runs"].pop(0) if len(state["runs"]) > 1 else state["runs"][0]
                return {"workflow_runs": [{"id": 7, "status": st}]}
            steps = [{"name": step, "conclusion": "failure"}] if step else []
            return {"jobs": [{"id": 9, "name": "guard", "status": "completed", "conclusion": guard, "steps": steps}]}
        call = fake
        os.environ.update(GITHUB_REPOSITORY="o/r", PR="1", HEAD_SHA="abc", GH_TOKEN="t")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main()
        out = buf.getvalue()
        ok = rc == 0 and seen == want_calls and want_line in out and (noread or not found(state["body"]))
        fails += not ok
        print(("ok    " if ok else "FAIL  ") + "main: guard %s, step %s, runs %s, refuse %s, noread %s -> %s" % (guard, step, runs[-1], refuse, noread, seen))
        if not ok:
            print(out)
    call, PAUSE = real, 15
    return fails


def selftest():
    fails = 0
    cases = [
        ("Fixes X.\n\n---\n_Generated by [Claude Code](https://claude.ai/code/session_1)_\n", "Fixes X."),
        ("Fixes X.\n\n\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://claude.ai/code/session_1",
         "Fixes X."),
        ("Lines like Generated by Claude Code inside prose stay.", None),
        ("", None),
    ]
    for text, want in cases:
        got = new_body(text)
        ok = got == want
        fails += not ok
        print(("ok    " if ok else "FAIL  ") + repr(text[:40]) + " -> " + repr(got))
    fails += mock_main_selftest()
    print("FAILS=%d" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
