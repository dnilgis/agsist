#!/usr/bin/env python3
"""skip_watch.py: scheduled workflows that only skip, or run and do no work.

A job that skips is not late: it ran, on time, and did nothing. cron_health.py judges a clock by a
green run, so a workflow whose work job never starts looks healthy for weeks. One row in cron health,
"skip-only" (not critical), checked once a day:

  * a workflow gated by scripts/cron_gate.py (a gate job that the work jobs need): for each of its last
    TICKS clock ticks inside LOOKBACK_DAYS, newest first, the runs that started in [tick, tick + max-lag]
    and their jobs. A run did work when any job other than the gate job ran (any conclusion but skipped).
    The workflow is idle when none of its last TICKS ticks had a run that did work. A healthy workflow
    costs two calls: the newest tick's runs and one run's jobs.
  * any other workflow with a schedule or a workflow_run trigger: its finished runs of the last
    WINDOW_HOURS (at least the last TICKS, at most 100). Idle when every one of them was skipped. A
    workflow that runs in a time window (skipped outside it) still has a run that worked in a day.

The row lists the idle workflows by file name in `idle` (the health file is private); `why` says how many.
Fail soft: a workflow whose runs cannot be read is counted as unknown, never as idle.

    python3 scripts/skip_watch.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import shlex
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cron_gate import ticks, parse_ts  # noqa: E402

UTC = timezone.utc
ROOT = os.path.dirname(HERE)
TICKS = 5                # the last five runs (or ticks) all idle
LOOKBACK_DAYS = 35       # ticks older than this are not looked at (run history is trimmed)
WINDOW_HOURS = 26        # a plain scheduled workflow: a whole day of its runs, so a time window still shows work
MAX_TICKS = 10           # ticks asked about per gated workflow, newest first
EVERY_HOURS = 23         # one pass a day; the saved row is reused in between
SKIPPED = {"skipped"}
NOT_A_RUN = {"cancelled", "startup_failure", None}
ROW = "skip-only"


def _ts(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_workflow(text):
    """{'auto': bool, 'gate_jobs': set of job names that run the cron gate, 'crons': [...], 'max_lag': int}"""
    head = text.split("\njobs:", 1)[0]
    auto = bool(re.search(r"^\s+(schedule|workflow_run):", head, re.M)) or bool(
        re.search(r"^on:\s*\[?[^\n]*\b(schedule|workflow_run)\b", head, re.M))
    gate_jobs, crons, lag = set(), [], None
    body = text.split("\njobs:", 1)[1] if "\njobs:" in text else ""
    parts = re.split(r"^  ([A-Za-z0-9_-]+):[ \t]*$", body, flags=re.M)
    for jid, block in zip(parts[1::2], parts[2::2]):
        m = re.search(r"cron_gate\.py tick((?:[^\n]|\\\n)*(?:\n\s+--[^\n]*)*)", block)
        if not m:
            continue
        nm = re.search(r"^    name:\s*(.+?)\s*$", block, re.M)
        gate_jobs.add(nm.group(1).strip("'\"") if nm else jid)
        for t in re.finditer(r"cron_gate\.py tick((?:[^\n]|\\\n)*(?:\n\s+--[^\n]*)*)", block):
            args = shlex.split(t.group(1).replace("\\\n", " "))
            crons += [args[i + 1] for i, a in enumerate(args[:-1]) if a == "--cron"]
            for i, a in enumerate(args[:-1]):
                if a == "--max-lag":
                    try:
                        lag = max(lag or 0, int(args[i + 1]))
                    except ValueError:
                        pass
    return {"auto": auto, "gate_jobs": gate_jobs, "crons": crons, "max_lag": lag or 30}


def scheduled_workflows(root=ROOT):
    wd = os.path.join(root, ".github", "workflows")
    out = {}
    for f in sorted(os.listdir(wd)):
        if not f.endswith((".yml", ".yaml")):
            continue
        w = parse_workflow(open(os.path.join(wd, f), encoding="utf-8").read())
        if w["auto"]:
            out[f] = w
    return out


def did_work(jobs, gate_jobs):
    """A run did work when a job other than the gate job ran."""
    return any(j.get("name") not in gate_jobs and j.get("conclusion") not in SKIPPED | {None}
               for j in jobs)


def gated_idle(wf, w, now, get, base):
    """(idle, ticks judged) for a cron-gated workflow. A tick with no run at all is not evidence (run
    history is trimmed; cron_health's own row says when a tick was missed): it is passed over, and at
    most MAX_TICKS ticks are asked about."""
    lag = timedelta(minutes=w["max_lag"])
    found = [t for t in ticks(w["crons"], now - timedelta(days=LOOKBACK_DAYS), now) if t + lag <= now]
    judged = 0
    for t in found[::-1][:MAX_TICKS]:
        runs = get("%s/actions/workflows/%s/runs?per_page=20&exclude_pull_requests=true&created=%s..%s"
                   % (base, wf, _ts(t), _ts(t + lag))).get("workflow_runs", [])
        runs = sorted((r for r in runs if r.get("conclusion") not in NOT_A_RUN), key=lambda r: r["created_at"])
        if not runs:
            continue
        judged += 1
        for r in runs[:2]:
            jobs = get("%s/actions/runs/%s/jobs?per_page=50" % (base, r["id"])).get("jobs", [])
            if did_work(jobs, w["gate_jobs"]):
                return False, TICKS
        if judged >= TICKS:
            return True, TICKS
    return False, judged


def plain_idle(wf, now, get, base):
    """(idle, runs looked at) for any other scheduled workflow."""
    runs = get("%s/actions/workflows/%s/runs?per_page=100&exclude_pull_requests=true&status=completed"
               % (base, wf)).get("workflow_runs", [])
    runs = [r for r in runs if r.get("conclusion") not in NOT_A_RUN]
    recent = [r for r in runs if parse_ts(r["created_at"]) >= now - timedelta(hours=WINDOW_HOURS)]
    look = recent if len(recent) >= TICKS else runs[:TICKS]
    if len(look) < TICKS:
        return False, len(look)
    return all(r.get("conclusion") in SKIPPED for r in look), len(look)


def _get(token):
    def get(url):
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json", "Authorization": "Bearer %s" % token,
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-cron-health"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    return get


def row(now, prev, repo, token, api="https://api.github.com", root=ROOT, get=None):
    base_row = {"workflow": ROW, "critical": False,
                "clock": "scheduled workflows whose last %d runs all skipped or did no work, checked once a day" % TICKS}
    try:
        last = parse_ts((prev or {}).get("checked_at", ""))
    except ValueError:
        last = None
    if prev and last and now - last < timedelta(hours=EVERY_HOURS):
        return dict(prev)
    if get is None:
        if not token:
            return dict(base_row, status="unknown", why="no token to read the run list")
        get = _get(token)
    base = "%s/repos/%s" % (api, repo)
    idle, unknown, n, young = [], [], 0, 0
    for wf, w in scheduled_workflows(root).items():
        try:
            if w["crons"] and w["gate_jobs"]:
                bad, looked = gated_idle(wf, w, now, get, base)
            else:
                bad, looked = plain_idle(wf, now, get, base)
        except Exception:
            unknown.append(wf)
            continue
        if looked < TICKS:
            young += 1      # fewer than TICKS runs or ticks in reach: not judged
            continue
        n += 1
        if bad:
            idle.append(wf)
    stamp = _ts(now)
    tail = ("; %d could not be read" % len(unknown)) if unknown else ""
    tail += ("; %d with too few runs to judge" % young) if young else ""
    if idle:
        return dict(base_row, status="late", checked_at=stamp, idle=idle, unknown=unknown,
                    why="%d scheduled workflow%s only skipped or did no work in %s last %d runs%s"
                    % (len(idle), "" if len(idle) == 1 else "s", "its" if len(idle) == 1 else "their", TICKS, tail))
    if unknown and not n:
        return dict(base_row, status="unknown", checked_at=stamp, unknown=unknown, why="no run list could be read")
    return dict(base_row, status="ok", checked_at=stamp, idle=[], unknown=unknown,
                why="%d scheduled workflows did work in their last %d runs%s" % (n, TICKS, tail))


# ── selftest ───────────────────────────────────────────────────────────────────
def selftest():
    import tempfile
    bad = []

    def ck(name, ok):
        print(("  ok    " if ok else "  FAIL  ") + name)
        if not ok:
            bad.append(name)

    gated = """name: G
on:
  workflow_run:
    workflows: ["Fetch Grain Bids"]
    types: [completed]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - id: g
        run: >-
          python3 scripts/cron_gate.py tick --workflow g.yml --max-lag 30
          --cron "17 13 * * *"
  work:
    needs: gate
    if: needs.gate.outputs.go == '1'
    runs-on: ubuntu-latest
    steps:
      - run: echo
"""
    windowed = """name: W
on:
  workflow_run:
    workflows: ["Fetch Grain Bids"]
    types: [completed]
  workflow_dispatch:
jobs:
  tick:
    if: >-
      github.event_name == 'workflow_dispatch' || ((vars.X || 'on') != '0' && contains(github.event.workflow_run.created_at, 'T13:'))
    runs-on: ubuntu-latest
    steps:
      - run: echo
"""
    manual = "name: M\non:\n  workflow_dispatch:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n"
    pg, pw, pm = parse_workflow(gated), parse_workflow(windowed), parse_workflow(manual)
    ck("a chained gated workflow: automatic, its gate job and clock found",
       pg["auto"] and pg["gate_jobs"] == {"gate"} and pg["crons"] == ["17 13 * * *"] and pg["max_lag"] == 30)
    ck("a windowed workflow is automatic with no gate", pw["auto"] and not pw["gate_jobs"] and not pw["crons"])
    ck("a by-hand workflow is not watched", not pm["auto"])

    now = datetime(2026, 11, 11, 20, 0, tzinfo=UTC)

    def runs_every_15(conclusion_at, hours=30):
        out, t, i = [], now - timedelta(hours=hours), 0
        while t < now:
            out.append({"id": i, "created_at": _ts(t), "conclusion": conclusion_at(t), "event": "workflow_run"})
            t += timedelta(minutes=15)
            i += 1
        return out[::-1]

    def api(all_runs, jobs_of):
        def get(url):
            if "/jobs" in url:
                rid = int(re.search(r"/runs/(\d+)/jobs", url).group(1))
                return {"jobs": jobs_of(rid)}
            m = re.search(r"created=([^.&]+)\.\.([^&]+)", url)
            rs = all_runs
            if m:
                a, b = parse_ts(m.group(1)), parse_ts(m.group(2))
                rs = [r for r in rs if a <= parse_ts(r["created_at"]) <= b]
            return {"workflow_runs": rs[:100]}
        return get

    base = "https://api.example/repos/o/r"
    always_skip = runs_every_15(lambda t: "skipped")
    ck("a workflow whose every run in a day skipped is idle (the shadow test case)",
       plain_idle("w.yml", now, api(always_skip, None), base)[0] is True)
    in_window = runs_every_15(lambda t: "success" if t.hour == 13 else "skipped")
    ck("a windowed workflow that worked once in the day is not idle, though its last 5 runs skipped",
       plain_idle("w.yml", now, api(in_window, None), base)[0] is False)
    ck("too few runs to judge: not idle", plain_idle("w.yml", now, api(always_skip[:3], None), base)[0] is False)

    gate_only = lambda rid: [{"name": "gate", "conclusion": "success"}, {"name": "work", "conclusion": "skipped"}]
    worked = lambda rid: [{"name": "gate", "conclusion": "success"}, {"name": "work", "conclusion": "failure"}]
    ok_runs = runs_every_15(lambda t: "success", hours=24 * 8)
    ck("a gated workflow whose last 5 ticks never got past the gate is idle",
       gated_idle("g.yml", pg, now, api(ok_runs, gate_only), base) == (True, 5))
    calls = []
    g2 = api(ok_runs, worked)
    ck("a gated workflow whose newest tick did work is not idle (a failed work job still tried)",
       gated_idle("g.yml", pg, now, lambda u: calls.append(u) or g2(u), base) == (False, 5))
    ck("a healthy gated workflow costs two calls", len(calls) == 2)
    young = dict(pg, crons=["17 13 1 * *"])
    ck("a monthly clock with under 5 ticks in reach is not judged", gated_idle("g.yml", young, now, api(ok_runs, gate_only), base)[0] is False)

    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, ".github", "workflows"))
        for name, text in (("g.yml", gated), ("w.yml", windowed), ("m.yml", manual)):
            open(os.path.join(d, ".github", "workflows", name), "w").write(text)
        ck("only automatic workflows are watched", sorted(scheduled_workflows(d)) == ["g.yml", "w.yml"])

        def fake(url):
            if "/workflows/w.yml/" in url:
                return api(always_skip, None)(url)
            return api(ok_runs, worked)(url)
        r = row(now, None, "o/r", "", root=d, get=fake)
        ck("the row is late (not critical) and lists the idle workflow privately",
           r["status"] == "late" and not r["critical"] and r["idle"] == ["w.yml"] and "w.yml" not in r["why"]
           and r["why"].startswith("1 scheduled workflow only skipped"))
        again = row(now + timedelta(hours=2), r, "o/r", "", root=d, get=lambda u: (_ for _ in ()).throw(AssertionError(u)))
        ck("checked once a day: the saved row is reused", again == r)
        r2 = row(now + timedelta(hours=24), r, "o/r", "", root=d, get=lambda u: (_ for _ in ()).throw(OSError("down")))
        ck("an unreadable run list is unknown, never idle", r2["status"] == "unknown" and r2["unknown"] == ["g.yml", "w.yml"])
        r4 = row(now, None, "o/r", "", root=d, get=api(always_skip[:2], gate_only))
        ck("workflows with too few runs, or no run at their ticks, are not judged and are counted apart",
           r4["status"] == "ok" and r4["idle"] == [] and "2 with too few runs to judge" in r4["why"])
        r3 = row(now, None, "o/r", "", root=d, get=api(ok_runs, worked))
        ck("all working: ok", r3["status"] == "ok" and r3["idle"] == [])
        ck("no token, no getter: unknown", row(now, None, "o/r", "", root=d)["status"] == "unknown")

    real = scheduled_workflows(ROOT)
    ck("the real workflows parse: over 50 automatic, the shadow test among them, a gated one with a clock",
       len(real) > 50 and "implied-futures.yml" in real and not real["implied-futures.yml"]["gate_jobs"]
       and any(w["crons"] and w["gate_jobs"] for w in real.values()))
    print("SELFTEST " + ("OK" if not bad else "FAILED: %s" % bad))
    return 0 if not bad else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print("usage: python3 scripts/skip_watch.py --selftest (the row is built by scripts/cron_health.py)")
