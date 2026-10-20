#!/usr/bin/env python3
"""
daily_site_check.py: once a day, after the morning data runs, is the site
telling one story, and is everything it depends on still moving?

Runs from .github/workflows/daily-site-check.yml (Sig approved 2026-10-17).
Three checks, all of them existing ones, none of them new rules:
  numbers    scripts/check_number_consistency.py --strict (the same number
             everywhere, and its staleness rule: each data file's own date
             against a maximum age)
  clocks     scripts/cron_health.py, written to the runner's temp dir (never
             committed from here): every watched workflow whose latest tick
             was not served
  freshness  data/daily.json is today's issue (Central time) once the
             morning window has passed

Findings become ::warning:: annotations, a table in the run summary, and ONE
GitHub issue titled "Daily site check": opened when there are findings,
its body replaced on each run while there are, and closed with a comment on
the first clean run. Nothing else is posted anywhere, nothing is committed,
and no model is called.

    python3 scripts/daily_site_check.py            # needs GITHUB_TOKEN, GITHUB_REPOSITORY
    python3 scripts/daily_site_check.py --dry      # checks and summary, no issue
    python3 scripts/daily_site_check.py --selftest
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
TITLE = "Daily site check"
ANNOT = re.compile(r"^::(warning|error)(?: ([^:]*))?::(.*)$")


def parse_annotations(text, check):
    out = []
    for line in (text or "").splitlines():
        m = ANNOT.match(line.strip())
        if not m:
            continue
        props = dict(p.split("=", 1) for p in (m.group(2) or "").split(",") if "=" in p)
        out.append({"check": check, "where": props.get("file", ""),
                    "title": props.get("title", check), "detail": m.group(3).strip()})
    return out


def numbers_check():
    """check_number_consistency.py --strict: its annotations are the findings.
    A nonzero exit with no annotation (a crash) is a finding of its own."""
    p = subprocess.run([sys.executable, os.path.join(HERE, "check_number_consistency.py"), "--strict"],
                       cwd=REPO_ROOT, capture_output=True, text=True)
    found = parse_annotations(p.stdout + "\n" + p.stderr, "numbers")
    if p.returncode != 0 and not found:
        tail = (p.stdout + p.stderr).strip().splitlines()[-3:]
        found.append({"check": "numbers", "where": "scripts/check_number_consistency.py",
                      "title": "number check did not finish", "detail": " / ".join(tail)[:300]})
    return found


def clock_findings(doc):
    out = []
    for w in (doc or {}).get("workflows", []):
        if w.get("status") not in ("ok", None):
            out.append({"check": "clocks", "where": w.get("workflow", ""),
                        "title": ("late (critical)" if w.get("critical") else "late") if w.get("status") not in ("over", "warn")
                        else ("folder near its budget" if w.get("workflow") == "folder-budgets" else "published size"),
                        "detail": f"{w.get('why', '')}; last success {w.get('last_success') or 'never'}"})
    return out


def clocks_check():
    out_path = os.path.join(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir(), "cron-health.json")
    env = dict(os.environ)
    env.pop("GITHUB_OUTPUT", None)     # cron_health writes commit/red there; this job reads the file
    p = subprocess.run([sys.executable, os.path.join(HERE, "cron_health.py"), "--out", out_path],
                       cwd=REPO_ROOT, capture_output=True, text=True, env=env)
    try:
        with open(out_path) as f:
            return clock_findings(json.load(f))
    except Exception as e:
        return [{"check": "clocks", "where": "scripts/cron_health.py", "title": "clock check did not finish",
                 "detail": f"{type(e).__name__}: {e}; " + (p.stderr or p.stdout).strip()[-200:]}]


def central_now(now=None):
    """US Central wall clock, DST by the US rule (second Sunday of March to the
    first Sunday of November, 2 a.m. local), without a tz database."""
    now = now or datetime.now(timezone.utc)
    y = now.year

    def nth_sunday(month, n):
        d = datetime(y, month, 1, tzinfo=timezone.utc)
        d += timedelta(days=(6 - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    start = nth_sunday(3, 2) + timedelta(hours=8)    # 2 a.m. CST = 08:00 UTC
    end = nth_sunday(11, 1) + timedelta(hours=7)     # 2 a.m. CDT = 07:00 UTC
    off = -5 if start <= now < end else -6
    return now + timedelta(hours=off)


def daily_findings(daily, now=None):
    """The Daily is today's issue by mid-morning Central (the three morning
    crons are 10:19, 11:41 and 13:23 UTC; this job runs at 11:37 UTC, so a
    finding here means the first two did not land one)."""
    ct = central_now(now)
    want = ct.strftime("%A, %B ") + str(ct.day) + ct.strftime(", %Y")
    have = (daily or {}).get("date", "")
    if have != want:
        return [{"check": "freshness", "where": "data/daily.json", "title": "Daily is not today's",
                 "detail": f"data/daily.json is dated {have or 'nothing'}; today in Central time is {want}"}]
    return []


def freshness_check():
    try:
        with open(os.path.join(REPO_ROOT, "data", "daily.json")) as f:
            return daily_findings(json.load(f))
    except Exception as e:
        return [{"check": "freshness", "where": "data/daily.json", "title": "unreadable",
                 "detail": f"{type(e).__name__}: {e}"}]


def body_md(findings, run_url=""):
    esc = lambda s: str(s or "").replace("|", "\\|").replace("\n", " ")
    lines = [f"{len(findings)} finding(s) on the run of "
             f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
             + (f" ([run]({run_url}))" if run_url else "") + ".", "",
             "| check | where | what | detail |", "|---|---|---|---|"]
    for f in findings:
        lines.append(f"| {esc(f['check'])} | {esc(f['where'])} | {esc(f['title'])} | {esc(f['detail'])[:400]} |")
    lines += ["", "Written by scripts/daily_site_check.py (daily-site-check.yml). "
              "This issue is replaced on each run while there are findings and closed on the first clean run."]
    return "\n".join(lines)


def plan(existing, findings):
    """What to do with the one issue: (action, issue_number or None)."""
    if findings:
        return ("update", existing["number"]) if existing else ("create", None)
    return ("close", existing["number"]) if existing else ("none", None)


# ── GitHub REST, issues only ─────────────────────────────────────────────────

def _gh(method, path, token, payload=None):
    req = urllib.request.Request("https://api.github.com" + path, method=method,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Authorization": f"Bearer {token}",
                                          "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28",
                                          "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
    return json.loads(raw) if raw else {}


def find_issue(repo, token):
    for page in range(1, 6):
        items = _gh("GET", f"/repos/{repo}/issues?state=open&per_page=100&page={page}", token)
        for it in items:
            if it.get("title") == TITLE and "pull_request" not in it:
                return it
        if len(items) < 100:
            break
    return None


def apply(action, number, repo, token, body):
    if action == "create":
        it = _gh("POST", f"/repos/{repo}/issues", token, {"title": TITLE, "body": body})
        print(f"opened issue #{it.get('number')}")
    elif action == "update":
        _gh("PATCH", f"/repos/{repo}/issues/{number}", token, {"body": body})
        print(f"updated issue #{number}")
    elif action == "close":
        _gh("POST", f"/repos/{repo}/issues/{number}/comments", token,
            {"body": "Clean run on " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + "; closing."})
        _gh("PATCH", f"/repos/{repo}/issues/{number}", token, {"state": "closed", "state_reason": "completed"})
        print(f"closed issue #{number}")
    else:
        print("clean; no issue open")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    findings = numbers_check() + clocks_check() + freshness_check()
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    run_url = (f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{repo}/actions/runs/"
               f"{os.environ['GITHUB_RUN_ID']}") if os.environ.get("GITHUB_RUN_ID") and repo else ""
    for f in findings:
        print(f"::warning title=Daily site check {f['check']}::{f['where']}: {f['title']}: {f['detail']}"[:1000])
    md = "## Daily site check\n\n" + (body_md(findings, run_url) if findings else "Clean.") + "\n"
    print(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(md)
    if "--dry" in argv:
        return 0
    token = os.environ.get("GITHUB_TOKEN", "")
    if not (token and repo):
        print("::warning::GITHUB_TOKEN or GITHUB_REPOSITORY not set; issue not touched")
        return 0
    action, number = plan(find_issue(repo, token), findings)
    apply(action, number, repo, token, body_md(findings, run_url))
    return 0


def selftest():
    ok = True

    def ck(name, cond):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + name)
        ok = ok and cond
    a = parse_annotations("x\n::warning file=data/a.json,title=number check arc-prices::corn: 4.96 vs 4.91\n"
                          "  staleness 6 compared\n::error::boom", "numbers")
    ck("annotations parsed", len(a) == 2 and a[0]["where"] == "data/a.json" and a[0]["title"] == "number check arc-prices"
       and a[0]["detail"] == "corn: 4.96 vs 4.91" and a[1]["detail"] == "boom")
    doc = {"workflows": [{"workflow": "a.yml", "status": "ok"},
                         {"workflow": "b.yml", "status": "late", "critical": True, "why": "tick 10:00Z not served"},
                         {"workflow": "pages size", "status": "over", "why": "905 MB"}]}
    cf = clock_findings(doc)
    ck("late and over rows are findings, ok rows are not",
       [f["where"] for f in cf] == ["b.yml", "pages size"] and cf[0]["title"] == "late (critical)")
    now = datetime(2026, 10, 17, 11, 37, tzinfo=timezone.utc)     # 6:37 a.m. CDT, a Saturday
    ck("today's Daily is clean", daily_findings({"date": "Saturday, October 17, 2026"}, now) == [])
    ck("yesterday's Daily is a finding", len(daily_findings({"date": "Friday, October 16, 2026"}, now)) == 1)
    ck("Central time in January is UTC-6",
       central_now(datetime(2026, 1, 15, 5, 30, tzinfo=timezone.utc)).day == 14)
    ck("plan: findings and no issue opens one", plan(None, cf) == ("create", None))
    ck("plan: findings and an open issue updates it", plan({"number": 7}, cf) == ("update", 7))
    ck("plan: clean and an open issue closes it", plan({"number": 7}, []) == ("close", 7))
    ck("plan: clean and no issue does nothing", plan(None, []) == ("none", None))
    b = body_md([{"check": "numbers", "where": "x|y", "title": "t", "detail": "d"}])
    ck("body escapes pipes", "x\\|y" in b)
    ck("no em dashes in what this writes", "\u2014" not in b and "\u2014" not in TITLE)
    print("selftest " + ("ok" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
