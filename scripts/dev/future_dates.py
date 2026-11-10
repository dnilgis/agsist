#!/usr/bin/env python3
"""Run the tests and the send gates' self-tests with the clock set to a future date (Nov 3, 2026).

Before a calendar boundary (month end, DST, a holiday, year end, a report window) run this: anything that fails
only on a future date is a test or a gate that reads today's date and will break on that day.

  python3 scripts/dev/future_dates.py                      the standing dates (DATES below), plus a run at today
  python3 scripts/dev/future_dates.py 2026-12-31 2027-01-01T14:30
  options:
    --browser        also the node tests that open Chromium (slow: about 55 minutes a date on 4 cores)
    --checks         also the builders' --check lines (python3 scripts/X.py --check) from checks.sh and the workflows
    --only=node|py   one half only
    --files=a,b      only these node test files (test/x.test.mjs) and python commands whose script is named
    --jobs=N         parallel runs (default 2; never run this beside a full checks.sh, build rule 19)
    --fast           leave out the node files that take over 30 s (scripts/dev/test-durations.json) and the two
                     slowest selftests (build_atlas_pages, build_arc_plc): about a quarter of the time, for a busy machine
    --all            run every item on every date (by default the dates run only the items that read the clock in
                     the run at today: code in the checkout asked for "now", or the test opens Chromium)
    --selftest       check the fake clocks themselves (python, node, a vm context, shell date, the probe) and exit
    --no-baseline    skip the run at today's real date (then every failure is listed, not only the new ones)

How the clock moves: scripts/dev/fakeclock/ holds a python sitecustomize.py (time.time, datetime.now/utcnow/today,
date.today), a node --import preload (Date, Intl formatting of now, every vm context and every Playwright page)
and a `date` wrapper (written to a temp bin folder), all driven by AGSIST_FAKE_OFFSET (seconds to add). File times (mtime) and git stay real, so a
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
SLOW_PY = ("scripts/build_atlas_pages.py", "scripts/build_arc_plc.py")
# the shell `date` wrapper, written to a temp bin folder at run time (a repo file named "date" would match every
# test that says "date" in quick.sh's pick)
DATE_SHIM = r'''#!/bin/bash
# Fake clock for shell `date`, used only by scripts/dev/future_dates.py (on PATH first). With AGSIST_FAKE_OFFSET set and
# no date of its own given (-d/--date/-r/--reference/-f/--file/-s/--set), it prints the shifted now; otherwise real date.
REAL=/bin/date; [ -x "$REAL" ] || REAL=/usr/bin/date
[ -n "${AGSIST_FAKE_OFFSET:-}" ] || exec "$REAL" "$@"
for a in "$@"; do case "$a" in -d|-d*|--date*|-r|-r*|--reference*|-f|-f*|--file*|-s|-s*|--set*) exec "$REAL" "$@" ;; esac; done
[ -n "${AGSIST_CLOCK_PROBE:-}" ] && echo shell >> "$AGSIST_CLOCK_PROBE"
now=$("$REAL" +%s); off=${AGSIST_FAKE_OFFSET%.*}
exec "$REAL" -d "@$((now + off))" "$@"
'''


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


def shim_bin(outdir):
    b = os.path.join(outdir, "bin")
    os.makedirs(b, exist_ok=True)
    f = os.path.join(b, "date")
    with open(f, "w") as fh:
        fh.write(DATE_SHIM)
    os.chmod(f, 0o755)
    return b


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


def run_date(label, when, jobs, nfiles, pcmds, outdir, names=None, probe=False):
    """Run the items on the given date (None: the real clock). probe=True: the real clock through the shims, and
    each item's clock reads are recorded (see clock_readers)."""
    env = dict(os.environ)
    if when is not None or probe:
        off = int(when.timestamp() - time.time()) if when is not None else 0
        env.update(PYTHONDONTWRITEBYTECODE="1", AGSIST_FAKE_OFFSET=str(off), AGSIST_FAKE_NOW=(when or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   PYTHONPATH=CLOCK + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else ""),
                   NODE_OPTIONS=(env.get("NODE_OPTIONS", "") + f" --import {CLOCK}/clock.mjs").strip(),
                   PATH=shim_bin(outdir) + os.pathsep + env["PATH"])
    env.setdefault("PLAYWRIGHT_PATH", "/opt/node-tools/node_modules/playwright/index.mjs")
    env.setdefault("CHROMIUM_PATH", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    for k in ("AGSIST_TEST_FILES", "AGSIST_PICK_BASE"):
        env.pop(k, None)
    d = os.path.join(outdir, label)
    os.makedirs(d, exist_ok=True)
    work = [(["node", "--test", "--test-reporter=tap", f], f) for f in nfiles]
    work += [(c.split(), c) for c in pcmds]
    if names is not None:
        work = [w for w in work if w[1] in names]
    before = dirty()
    res = {}
    stem = lambda name: os.path.join(d, re.sub(r"[^\w.-]+", "_", name))
    def env_for(name):
        if not probe:
            return env
        p = stem(name) + ".probe"
        if os.path.exists(p):
            os.remove(p)
        return dict(env, AGSIST_CLOCK_PROBE=p)
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = [ex.submit(run_one, argv, env_for(name), stem(name) + ".log") for argv, name in work]
        for (argv, name), fut in zip(work, futs):
            _, rc, skipped, secs = fut.result()
            res[name] = "fail" if rc else ("skip" if skipped else "ok")
    after = dirty()
    changed = sorted(p for p in after if p not in before or after[p] != before[p])
    if probe:
        # which items read "now" from the checkout's own code (or opened Chromium, whose page clock is not probed)
        global READERS
        READERS = {name for _, name in work if os.path.exists(stem(name) + ".probe")
                   or (name.endswith(".test.mjs") and re.search(r"PLAYWRIGHT|playwright|chromium", open(os.path.join(ROOT, name), encoding="utf-8", errors="replace").read()))}
    return res, changed


READERS = None


def selftest():
    """The shims move the clock where they should, leave given dates and a test's own clock alone, and the probe
    sees a read from the checkout. A few seconds, no tests run."""
    import tempfile
    bad = []

    def ck(name, ok, got=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  -- {got!r}"))
        if not ok:
            bad.append(name)
    when = parse_when("2027-01-01T13:00")
    with tempfile.TemporaryDirectory() as td:
        off = str(int(when.timestamp() - time.time()))
        probe = os.path.join(td, "probe")
        env = dict(os.environ, AGSIST_FAKE_OFFSET=off, AGSIST_CLOCK_PROBE=probe, PYTHONDONTWRITEBYTECODE="1",
                   PYTHONPATH=CLOCK, NODE_OPTIONS=f"--import {CLOCK}/clock.mjs", PATH=shim_bin(td) + os.pathsep + os.environ["PATH"])
        env.pop("PLAYWRIGHT_PATH", None)
        py = subprocess.run(["python3", "-c", "import datetime, time, zlib; from datetime import date, datetime as D, timezone; "
                             "print(date.today(), D.now(timezone.utc).date(), D.utcnow().date(), time.strftime('%Y-%m-%d', time.gmtime()), "
                             "isinstance(date(2020, 1, 1), date), D(2020, 1, 2).date())"],
                            capture_output=True, text=True, env=env, cwd=td)
        ck("python: today, now, utcnow and time move; real dates stay real",
           py.stdout.split() == ["2027-01-01"] * 4 + ["True", "2020-01-02"], py.stdout + py.stderr)
        nd = subprocess.run(["node", "-e", "const vm = require('vm'); console.log([new Date().toISOString().slice(0, 10), new Date(2020, 0, 2).getDate(), "
                             "vm.runInNewContext('new Date().toISOString().slice(0, 10)'), vm.runInNewContext('Date.now()', { Date: { now: () => 5 } }), "
                             "new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric' }).format()].join(' '))"],
                            capture_output=True, text=True, env=env, cwd=td)
        ck("node: Date, a vm context and Intl move; a given date and a test's own clock do not",
           nd.stdout.split() == ["2027-01-01", "2", "2027-01-01", "5", "2027"], nd.stdout + nd.stderr)
        sh = subprocess.run(["date", "-u", "+%F"], capture_output=True, text=True, env=env)
        sd = subprocess.run(["date", "-u", "-d", "2020-01-02", "+%F"], capture_output=True, text=True, env=env)
        ck("shell date moves, date -d stays", (sh.stdout.strip(), sd.stdout.strip()) == ("2027-01-01", "2020-01-02"), (sh.stdout, sd.stdout))
        os.remove(probe) if os.path.exists(probe) else None
        subprocess.run(["python3", "-c", "import datetime; datetime.date(2020, 1, 1)"], env=env, cwd=td)
        ck("probe: a given date is not a read of the clock", not os.path.exists(probe))
        with open(os.path.join(td, "reads.py"), "w") as fh:
            fh.write("import datetime\nprint(datetime.date.today())\n")
        subprocess.run(["python3", "reads.py"], env=env, cwd=td, capture_output=True)
        ck("probe: a file in the checkout that asks for today is seen", os.path.exists(probe) and "python" in open(probe).read())
        os.remove(probe) if os.path.exists(probe) else None
        with open(os.path.join(td, "reads.mjs"), "w") as fh:
            fh.write("console.log(Date.now());\n")
        subprocess.run(["node", "reads.mjs"], env=env, cwd=td, capture_output=True)
        ck("probe: node too", os.path.exists(probe) and "node" in open(probe).read())
        # a page: the shift reaches it, and a test's own page clock (page.clock.setFixedTime) keeps Date.now() too
        # (Nov 4, 2026: Playwright copied the shim's enumerable now() onto its fake Date, so pages read today + offset)
        pw = os.environ.get("PLAYWRIGHT_PATH", "/opt/node-tools/node_modules/playwright/index.mjs")
        chrome = os.environ.get("CHROMIUM_PATH", "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
        if os.path.exists(pw) and os.path.exists(chrome):
            with open(os.path.join(td, "page.mjs"), "w") as fh:
                fh.write(f"const {{ chromium }} = await import({pw!r});\n"
                         f"const b = await chromium.launch({{ executablePath: {chrome!r} }});\n"
                         "const day = async (fixed) => { const ctx = await b.newContext({ serviceWorkers: 'block' }); const pg = await ctx.newPage();\n"
                         "  await pg.route('**/*', (r) => r.fulfill({ body: '<html></html>', contentType: 'text/html' }));\n"
                         "  if (fixed) await pg.clock.setFixedTime(new Date('2020-01-02T12:00:00Z'));\n"
                         "  await pg.goto('http://127.0.0.1:9/x');\n"
                         "  const v = await pg.evaluate(() => [new Date().toISOString().slice(0, 10), new Date(Date.now()).toISOString().slice(0, 10)].join(' '));\n"
                         "  await ctx.close(); return v; };\n"
                         "try { console.log(await day(false) + ' ' + await day(true)); } finally { await b.close(); }\n")
            penv = dict(env, PLAYWRIGHT_PATH=pw)
            pg = subprocess.run(["node", "page.mjs"], capture_output=True, text=True, env=penv, cwd=td, timeout=120)
            ck("page: the shift reaches a page; a page clock the test fixed stays fixed",
               pg.stdout.split() == ["2027-01-01", "2027-01-01", "2020-01-02", "2020-01-02"], pg.stdout + pg.stderr[-400:])
        else:
            print("skip page: Playwright or Chromium not found here")
    print(f"future_dates selftest: {'ok' if not bad else str(len(bad)) + ' failed'}")
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    opts = {"all": False, "fast": False, "browser": False, "checks": False, "only": "", "files": "", "jobs": "2", "baseline": True}
    dates = []
    for a in argv:
        if a == "--browser":
            opts["browser"] = True
        elif a == "--all":
            opts["all"] = True
        elif a == "--fast":
            opts["fast"] = True
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
    if opts["fast"]:
        import json
        secs = json.load(open(os.path.join(ROOT, "scripts", "dev", "test-durations.json"))).get("seconds", {})
        nfiles = [f for f in nfiles if secs.get(f, 0) <= 30]
        pcmds = [c for c in pcmds if c.split()[1] not in SLOW_PY]
    jobs = max(1, int(opts["jobs"]))
    outdir = os.path.join(os.environ.get("TMPDIR", "/tmp"), "agsist-future-dates")
    print(f"future_dates: {len(nfiles)} node test file(s), {len(pcmds)} script check(s), dates {', '.join(d for d, _ in whens)}; logs in {outdir}")
    base = {}
    if opts["baseline"]:
        base, ch = run_date("today", None, jobs, nfiles, pcmds, outdir, probe=True)
        bad = sorted(k for k, v in base.items() if v != "ok")
        print(f"today (real clock): {len(base) - len(bad)} ok, {len(bad)} not ok" + "".join(f"\n  {base[k]}: {k}" for k in bad))
        if not opts["all"]:
            # an item that never read the clock cannot change with the date: the dates run the readers only
            print(f"  {len(READERS)} of {len(base)} read today's clock (or open Chromium); the dates run those (--all: every item)")
        if ch:
            print("  changed in the checkout by the run: " + ", ".join(ch))
    new_total = 0
    for label, when in whens:
        res, ch = run_date(label, when, jobs, nfiles, pcmds, outdir, READERS if opts["baseline"] and not opts["all"] else None)
        bad = sorted(k for k, v in res.items() if v != "ok")
        new = [k for k in bad if base.get(k, "ok") == "ok" or not opts["baseline"]]
        # a busy machine fails timing tests at any date: each new failure runs again alone, once on the real
        # clock and once on this date. Only "fails on this date, passes on today's" counts as the date.
        why = {}
        if new:
            # twice each: under load a timing test can fail on either clock
            ctl, again = {}, {}
            for i in (1, 2):
                c1, _ = run_date(f"{label}-control{i}", None, 1, nfiles, pcmds, outdir, set(new))
                a1, _ = run_date(f"{label}-again{i}", when, 1, nfiles, pcmds, outdir, set(new))
                for k in new:
                    ctl[k] = "ok" if ctl.get(k) == "ok" or c1.get(k) == "ok" else "fail"
                    again[k] = "ok" if again.get(k) == "ok" or a1.get(k) == "ok" else "fail"
            for k in new:
                why[k] = ("date" if again[k] != "ok" and ctl[k] == "ok" else
                          "flaky (passed when run again alone)" if again[k] == "ok" else "fails on today's clock too")
        dated = [k for k in new if why.get(k) == "date"]
        new_total += len(dated)
        print(f"{label} ({when:%Y-%m-%d %H:%M} UTC): {len(res) - len(bad)} ok, {len(bad)} not ok, {len(dated)} from the date"
              + "".join(f"\n  {res[k]}: {k} [{why[k]}]   (log {outdir}/{label}/{re.sub(r'[^\w.-]+', '_', k)}.log)" for k in new))
        if ch:
            print("  changed in the checkout by the run: " + ", ".join(ch))
    print(f"future_dates: {new_total} failure(s) that come from the date")
    return 1 if new_total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
