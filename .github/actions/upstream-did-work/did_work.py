#!/usr/bin/env python3
"""did_work.py: did the workflow run that started this one do its work?

Used by .github/actions/upstream-did-work (see its action.yml). Reads EVENT,
RUN_ID, UPSTREAM, REPO, API and GH_TOKEN from the environment, lists the jobs
of the upstream run (the latest attempt) and writes go=0|1 to $GITHUB_OUTPUT.

  go=1  not a workflow_run event; or the upstream run has no job named "gate" or
        "upstream" (the two filter jobs); or another of its jobs ended success.
  go=0  the upstream's gate skipped every working job (or they failed); or the
        jobs could not be read (fail closed: a missed chained run is caught by
        the next one or the backstop schedule, a false one rebuilds or mails).

Lives beside the action, not in scripts/, so it never comes from the engine copy.

    python3 .github/actions/upstream-did-work/did_work.py --selftest
"""
import json
import os
import sys
import urllib.request


# A cron_gate.py gate, and this action's own job: a workflow that follows a filtered workflow
# (farmland-atlas-watch after farmland-atlas-pages) must see through both.
FILTER_JOBS = {"gate", "upstream"}


def decide(event, jobs):
    """(go, reason). jobs: [{"name", "conclusion"}] of the upstream run, or None when unreadable."""
    if event != "workflow_run":
        return 1, "%s: not a chained run" % (event or "no event")
    if not jobs:
        return 0, "upstream jobs unreadable or empty; fail closed"
    names = [j.get("name") for j in jobs]
    if not FILTER_JOBS & set(names):
        return 1, "upstream has no gate job: %s" % ", ".join(n or "?" for n in names)
    did = [j["name"] for j in jobs if j.get("name") not in FILTER_JOBS and j.get("conclusion") == "success"]
    if did:
        return 1, "upstream did its work (%s)" % ", ".join(did)
    return 0, "upstream's gate skipped its work (%s)" % ", ".join(
        "%s=%s" % (j.get("name"), j.get("conclusion")) for j in jobs)


def read_jobs(api, repo, run_id, token):
    url = "%s/repos/%s/actions/runs/%s/jobs?filter=latest&per_page=100" % (api, repo, int(run_id))
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-upstream-did-work"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [{"name": j.get("name"), "conclusion": j.get("conclusion")} for j in json.loads(r.read().decode()).get("jobs", [])]


def selftest():
    fails = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)
    J = lambda *p: [{"name": n, "conclusion": c} for n, c in p]
    check(decide("schedule", None)[0] == 1, "a scheduled run always goes")
    check(decide("workflow_dispatch", None)[0] == 1, "a run by hand always goes")
    check(decide("workflow_run", J(("gate", "success"), ("build", "skipped")))[0] == 0,
          "the upstream's gate skipped it: no go (the every-15-minutes case)")
    check(decide("workflow_run", J(("gate", "success"), ("build", "success")))[0] == 1,
          "the upstream did its work: go")
    check(decide("workflow_run", J(("gate", "success"), ("probe", "skipped"), ("models", "success")))[0] == 1,
          "one working job of several did its work: go")
    check(decide("workflow_run", J(("gate", "success"), ("build", "failure")))[0] == 0,
          "the upstream's work failed: no go")
    check(decide("workflow_run", J(("fetch", "success")))[0] == 1, "an ungated upstream: go, as before")
    check(decide("workflow_run", J(("upstream", "success"), ("build", "skipped")))[0] == 0,
          "an upstream that was itself filtered out did nothing: no go")
    check(decide("workflow_run", J(("upstream", "success"), ("build", "success")))[0] == 1,
          "an upstream that passed its own filter and built: go")
    check(decide("workflow_run", None)[0] == 0, "jobs unreadable: fail closed")
    check(decide("workflow_run", [])[0] == 0, "no jobs listed: fail closed")
    print("\n%d failed" % len(fails) if fails else "\nall did_work checks passed")
    return 1 if fails else 0


def main(argv):
    if argv[:1] in (["-h"], ["--help"]):
        print(__doc__)
        return 0
    if argv[:1] == ["--selftest"]:
        return selftest()
    if argv:
        print("did_work.py: unknown argument %s" % argv[0], file=sys.stderr)
        return 2
    e = os.environ
    event = e.get("EVENT", "")
    jobs = None
    if event == "workflow_run":
        try:
            jobs = read_jobs(e.get("API") or "https://api.github.com", e["REPO"], e["RUN_ID"], e.get("GH_TOKEN", ""))
        except Exception as x:
            print("::warning::could not list the jobs of %s run %s (%s); not going" % (e.get("UPSTREAM"), e.get("RUN_ID"), x))
    go, why = decide(event, jobs)
    print("go=%d (%s: %s)" % (go, e.get("UPSTREAM") or "-", why), file=sys.stderr)
    out = e.get("GITHUB_OUTPUT")
    text = "go=%d\n" % go
    if out:
        with open(out, "a") as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
