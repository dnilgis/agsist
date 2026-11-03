#!/usr/bin/env python3
"""Run the tests and the send gates' self-tests with the clock set to a future date (Sig, Nov 3, 2026).

Before a calendar boundary (month end, DST, a holiday, year end, a report window) run this: anything that fails
only on a future date is a test or a gate that reads today's date and will break on that day.

  python3 scripts/dev/future_dates.py                      the standing dates (DATES below), plus a run at today
  python3 scripts/dev/future_dates.py 2026-12-31 2027-01-01T14:30
  options:
    --browser        also the node tests that open Chromium (slow: about 55 minutes a date on 4 cores)
    --checks         also the builders' --check lines (python3 scripts/X.py --check) from checks.sh and the workflows
    --only=node|py   one half only
    --files=a,b      only these node test files (test/x.test.mjs) and python commands whose script is named
    --jobs=N         parallel runs (default 2; never run this beside a full checks.sh, BUILD-RULES 19)
    --no-baseline    skip the run at today's real date (then every failure is listed, not only the new ones)

How the clock moves: scripts/dev/fakeclock/ holds a python sitecustomize.py (time.time, datetime.now/utcnow/today,
date.today), a node --import preload (Date, Intl formatting of now, every vm context and every Playwright page)
and a `date` wrapper, all driven by AGSIST_FAKE_OFFSET (seconds to add). File times (mtime) and git stay real, so a
test that compares a file's mtime with Date.now() (test/claude-hooks.test.mjs, the verify gate) fails here and only
here: that one is the harness, not the date. Code needs no override of its own; a date without a
time runs at 13:00 UTC (7 AM CT in winter, the Daily's hour).

What it runs: the node tests (test/*.test.mjs; the Chromium ones only with --browser), every scripts/test_*.py,
and every `--selftest` / test script line in .github/workflows/*.yml and scripts/dev/checks.sh (the Daily's
GATE 0 steps among them). Exit 1 when a date has a failure that the run at today does not have.
A file a run changed in the checkout is named (a test should write only to a temp folder); nothing is put back,
so run it from a clean checkout and look at `git status` afterward.
"""
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
try: import _argguard; _argguard.guard(__file__)  # scripts/_argguard.py: --help and bad flags exit before any work
except ImportError: pass
sys.path.pop(0)

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                      cwd=os.path.dirname(os.path.abspath(__file__))).stdout.strip()
CLOCK = os.path.join(ROOT, "scripts", "dev", "fakeclock")
# The standing dates (fx/timebombs brief, Nov 3, 2026): Thanksgiving, month ends and starts, WASDE days,
# year end, the Jan annual reports, the Feb projected-price window, the spring DST change.
DATES = ["2026-11-26", "2026-11-30", "2026-12-01", "2026-12-10", "2026-12-31", "2027-01-01", "2027-01-12",
         "2027-02-01", "2027-03-14"]
TIMEOUT = 600


def parse_when(s):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?Z?)?", s):
        sys.exit(f"future_dates: '{s}' is not YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC)")
    if "T" not in s:
        s += "T13:00"
    s = s.rstrip("Z")
    if s.count(":") == 1:
        s += ":00"
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def node_files(browser, only):
    out = []
    for f in sorted(os.listdir(os.path.join(ROOT, "test"))):
        if not f.endswith(".test.mjs"):
            continue
        rel = f"test/{f}"
        if only and rel not in only:
            continue
        src = open(os.path.join(ROOT, rel), encoding="utf-8", errors="replace").read()
        if not browser and re.search(r"PLAYWRIGHT|playwright|chromium", src):
            continue
        out.append(rel)
    return out


def py_commands(checks, only):
    cmds = []
    seen = set()

    def add(c):
        if c not in seen:
            seen.add(c)
            cmds.append(c)
    for f in sorted(os.listdir(os.path.join(ROOT, "scripts"))):
        if re.fullmatch(r"test_[\w-]+\.py", f):
            add(f"python3 scripts/{f}")
    srcs = [os.path.join(ROOT, "scripts", "dev", "checks.sh")]
    wf = os.path.join(ROOT, ".github", "workflows")
    srcs += [os.path.join(wf, f) for f in sorted(os.listdir(wf)) if f.endswith(".yml")]
    pat = re.compile(r"\b(?:python3?|node) (scripts/[\w./-]+\.(?:py|mjs))((?: --(?:selftest|check))?)(?=[\s;&|)'\"]|$)")
    for s in srcs:
        for m in pat.finditer(open(s, encoding="utf-8").read()):
            script, flag = m.group(1), m.group(2).strip()
            if "/dev/" in script or not os.path.isfile(os.path.join(ROOT, script)):
                continue
            name = os.path.basename(script)
            tool = "python3" if script.endswith(".py") else "node"
            if flag == "--selftest" or (not flag and (name.startswith("test_") or name.endswith("-checks.mjs"))):
                add(f"{tool} {script}{' ' + flag if flag else ''}")
            elif flag == "--check" and checks:
                add(f"{tool} {script} --check")
    if only:
        cmds = [c for c in cmds if c.split()[1] in only]
    return cmds


def dirty():
    r = subprocess.run(["git", "status", "--porcelain=v1", "-uall"], cwd=ROOT, capture_output=True, text=True)
    return {line[3:]: line[:2] for line in r.stdout.splitlines()}


def run_one(cmd, env, log):
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=TIMEOUT)
        rc, out = r.returncode, r.stdout + r.stderr
    except subprocess.TimeoutExpired as e:
        rc, out = 124, f"timed out after {TIMEOUT}s\n" + ((e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or ""))
    with open(log, "w") as fh:
        fh.write(out)
    # a node test file that only skipped did not pass either
    skipped = bool(re.search(r"^# skipped [1-9]", out, re.M)) and not re.search(r"^# pass [1-9]", out, re.M)
    return cmd, rc, skipped, round(time.time() - t0, 1)


def run_date(label, when, jobs, nfiles, pcmds, outdir):
    env = dict(os.environ)
    if when is not None:
        off = int(when.timestamp() - time.time())
        env.update(AGSIST_FAKE_OFFSET=str(off), AGSIST_FAKE_NOW=when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   PYTHONPATH=CLOCK + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""),
                   NODE_OPTIONS=(env.get("NODE_OPTIONS", "") + f" --import {CLOCK}/clock.mjs").strip(),
                   PATH=f"{CLOCK}/bin" + os.pathsep + env["PATH"])
    env.setdefault("PLAYWRIGHT_PATH", "/opt/node-tools/node_modules/playwright/index.mjs")
    env.setdefault("CHROMIUM_PATH", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    for k in ("AGSIST_TEST_FILES", "AGSIST_PICK_BASE"):
        env.pop(k, None)
    d = os.path.join(outdir, label)
    os.makedirs(d, exist_ok=True)
    work = [(["node", "--test", "--test-reporter=tap", f], f) for f in nfiles]
    work += [(c.split(), c) for c in pcmds]
    before = dirty()
    res = {}
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = [ex.submit(run_one, argv, env, os.path.join(d, re.sub(r"[^\w.-]+", "_", name) + ".log")) for argv, name in work]
        for (argv, name), fut in zip(work, futs):
            _, rc, skipped, secs = fut.result()
            res[name] = "fail" if rc else ("skip" if skipped else "ok")
    after = dirty()
    changed = sorted(p for p in after if p not in before or after[p] != before[p])
    return res, changed


def main(argv):
    opts = {"browser": False, "checks": False, "only": "", "files": "", "jobs": "2", "baseline": True}
    dates = []
    for a in argv:
        if a == "--browser":
            opts["browser"] = True
        elif a == "--checks":
            opts["checks"] = True
        elif a == "--no-baseline":
            opts["baseline"] = False
        elif a.startswith("--only="):
            opts["only"] = a.split("=", 1)[1]
        elif a.startswith("--files="):
            opts["files"] = a.split("=", 1)[1]
        elif a.startswith("--jobs="):
            opts["jobs"] = a.split("=", 1)[1]
        elif a.startswith("-"):
            sys.exit(f"future_dates: unknown option {a}")
        else:
            dates.append(a)
    whens = [(d, parse_when(d)) for d in (dates or DATES)]
    only = set(x for x in opts["files"].split(",") if x)
    nfiles = [] if opts["only"] == "py" else node_files(opts["browser"], only)
    pcmds = [] if opts["only"] == "node" else py_commands(opts["checks"], only)
    jobs = max(1, int(opts["jobs"]))
    outdir = os.path.join(os.environ.get("TMPDIR", "/tmp"), "agsist-future-dates")
    print(f"future_dates: {len(nfiles)} node test file(s), {len(pcmds)} script check(s), dates {', '.join(d for d, _ in whens)}; logs in {outdir}")
    base = {}
    if opts["baseline"]:
        base, ch = run_date("today", None, jobs, nfiles, pcmds, outdir)
        bad = sorted(k for k, v in base.items() if v != "ok")
        print(f"today (real clock): {len(base) - len(bad)} ok, {len(bad)} not ok" + "".join(f"\n  {base[k]}: {k}" for k in bad))
        if ch:
            print("  changed in the checkout by the run: " + ", ".join(ch))
    new_total = 0
    for label, when in whens:
        res, ch = run_date(label, when, jobs, nfiles, pcmds, outdir)
        bad = sorted(k for k, v in res.items() if v != "ok")
        new = [k for k in bad if base.get(k, "ok") == "ok" or not opts["baseline"]]
        new_total += len(new)
        print(f"{label} ({when:%Y-%m-%d %H:%M} UTC): {len(res) - len(bad)} ok, {len(bad)} not ok, {len(new)} only on this date"
              + "".join(f"\n  {res[k]}: {k}   (log {outdir}/{label}/{re.sub(r'[^\w.-]+', '_', k)}.log)" for k in new))
        if ch:
            print("  changed in the checkout by the run: " + ", ".join(ch))
    print(f"future_dates: {new_total} failure(s) that come from the date")
    return 1 if new_total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
