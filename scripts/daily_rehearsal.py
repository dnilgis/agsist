#!/usr/bin/env python3
"""
daily_rehearsal.py -- tomorrow's Daily, rehearsed the evening before.

WHY (Nov 3 2026). A self-test that compared its fixture with live data broke
overnight and held the morning's Daily for two hours.  This runs every evening, so every boundary is covered the night
before it arrives.

WHAT IT RUNS, with send off and nothing published or committed:
  1. the clock: Python started with tomorrow's clock really reads tomorrow
     (scripts/daily_clock/sitecustomize.py; DAILY_FAKE_NOW = tomorrow 5:50 AM CT)
  2. every code self-test of the Daily (scripts/daily_selftests.py, the same
     list daily.yml runs) under tomorrow's clock
  3. the morning gate itself (daily.yml's gate script, run by
     scripts/test_daily_schedule.py's simulator): at tomorrow's 5:50 floor a
     scheduled fire and a heartbeat must both decide to write the issue
  4. the generator's date-bound inputs under tomorrow's clock: market status,
     the USDA release of the day, the season, the weekly release line and the
     whole system prompt (generate_daily.py, no model call)
  5. GATE 1 (the feed check) on a copy of tonight's prices, under tomorrow's clock
  6. the content gates (GATE 2, the schema, GATE 2v) replayed on the newest
     published issue, on copies

The model is not called: tomorrow's prices and news do not exist yet, and the
writer's cost is not worth a rehearsal. Steps 5 and 6 judge tonight's data,
not tomorrow's, so only a crash there fails the rehearsal; a block is reported
as a note. Steps 1 to 4 fail on any failure.

A failure mails the owner once (scripts/log_safe.owner_mail), writes the job summary,
and exits 1 so the run goes red where the lead sees it. No address, count or
reader link anywhere.

    python3 scripts/daily_rehearsal.py                     tomorrow, Central
    python3 scripts/daily_rehearsal.py --date 2026-12-01   that morning
    python3 scripts/daily_rehearsal.py --no-mail           report only
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

CT = "America/Chicago"
FLOOR = (5, 50)          # just past the gate's 05:45 floor


def tomorrow_ct(now=None):
    from zoneinfo import ZoneInfo
    now = now or datetime.now(ZoneInfo(CT))
    return (now.astimezone(ZoneInfo(CT)).date() + timedelta(days=1)).isoformat()


def fake_now(day):
    """Tomorrow 5:50 AM Central with its own UTC offset (DST handled by zoneinfo)."""
    from zoneinfo import ZoneInfo
    d = date.fromisoformat(day)
    return datetime(d.year, d.month, d.day, FLOOR[0], FLOOR[1], tzinfo=ZoneInfo(CT)).isoformat()


def fake_env(day, base=None):
    e = dict(base if base is not None else os.environ)
    for k in ("ANTHROPIC_API_KEY", "SMTP_USER", "SMTP_PASS", "GMAIL_USER", "GMAIL_APP_PASS", "LIST_URL", "LIST_TOKEN",
              "RECIPIENTS", "FACT_CHECK_MODE", "FACT_CHECK_MODEL", "GITHUB_STEP_SUMMARY"):
        e.pop(k, None)
    e["PYTHONPATH"] = os.pathsep.join([str(HERE / "daily_clock")] + [p for p in [e.get("PYTHONPATH")] if p])
    e["DAILY_FAKE_NOW"] = fake_now(day)
    e["TZ"] = CT
    return e


def _py(code_or_args, env, timeout=180):
    args = code_or_args if isinstance(code_or_args, list) else ["-c", code_or_args]
    try:
        r = subprocess.run([sys.executable] + args, cwd=str(REPO), env=env, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return None, "did not finish in %d seconds" % timeout


def _row(label, ok, line="", note=False):
    return {"label": label, "ok": ok, "line": line, "note": note}


def check_clock(day, env):
    rc, out = _py("import datetime, time; print(datetime.date.today().isoformat(), time.strftime('%Y-%m-%d'))", env)
    got = out.strip().split()
    ok = rc == 0 and got == [day, day]
    return _row("tomorrow's clock takes", ok, "" if ok else "Python under the override reads %r, not %s" % (out.strip()[:80], day))


def check_selftests(env):
    import daily_selftests as S
    return [_row("self-test: " + r["label"], r["ok"], r["line"]) for r in S.run_all(env=env, echo=False)]


GATE_CODE = r"""
import sys, json
sys.path.insert(0, "scripts")
import test_daily_schedule as T
y = T.WF.read_text()
g = T.gate_script(y)
day, dow = sys.argv[1], int(sys.argv[2])
out = {}
out["schedule"] = T.simulate(g, event="schedule", start="05:50", day=day, dow=dow)[0]
out["heartbeat"] = T.simulate(g, event="workflow_dispatch", heartbeat=True, start="06:01", day=day, dow=dow)[0]
out["sent"] = T.simulate(g, event="workflow_dispatch", heartbeat=True, start="07:01", day=day, dow=dow, published=True, sent=True)[0]
print(json.dumps(out))
"""


def check_gate(day):
    dow = date.fromisoformat(day).isoweekday()
    rc, out = _py(["-c", GATE_CODE, day, str(dow)], dict(os.environ))
    try:
        got = json.loads(out.strip().splitlines()[-1])
    except Exception:                                        # noqa: BLE001
        import daily_selftests as S
        return _row("the morning gate for tomorrow", False, S.telling_line(out))
    want = {"schedule": "0", "heartbeat": "0", "sent": "1"}
    ok = rc == 0 and got == want
    return _row("the morning gate for tomorrow", ok, "" if ok else "decided %s, expected %s (0 = write the issue)" % (got, want))


INPUTS_CODE = r"""
import sys
sys.path.insert(0, "scripts")
import generate_daily as g
ms = g.get_market_status()
rel = g.get_usda_release_today()
season = g.get_seasonal_context()
weekly = g.weekly_release_line()
sp = g.build_system_prompt(ms, [], usda_release=rel)
assert isinstance(sp, str) and len(sp) > 1000, "the system prompt came back short"
print("inputs ok: %s, closed=%s, usda=%d chars, season=%d chars, prompt=%d chars" % (
    ms.get("day_name"), ms.get("is_closed"), len(rel or ""), len(season or ""), len(sp)))
"""


def check_inputs(env):
    import daily_selftests as S
    rc, out = _py(INPUTS_CODE, env)
    ok = rc == 0
    return _row("the generator's inputs for tomorrow", ok, "" if ok else S.telling_line(out))


def _crash(rc, out):
    return rc is None or "Traceback (most recent call last)" in out or rc not in (0, 1)


def check_replays(env_tomorrow, env_today):
    """GATE 1 on tonight's prices (tomorrow's clock), and the content gates on
    the newest published issue (its own day's clock), all on copies."""
    import daily_selftests as S
    rows = []
    tmp = Path(tempfile.mkdtemp(prefix="rehearsal-"))
    try:
        prices = REPO / "data" / "prices.json"
        issue = REPO / "data" / "daily.json"
        if prices.exists():
            shutil.copy(prices, tmp / "prices.json")
            shutil.copy(prices, tmp / "prices-gate1.json")       # --repair rewrites its own copy only
            rc, out = _py(["scripts/preflight_prices.py", str(tmp / "prices-gate1.json"), "--repair"], env_tomorrow)
            rows.append(_row("GATE 1 feed check runs", not _crash(rc, out), S.telling_line(out) if _crash(rc, out) else ""))
            if not _crash(rc, out) and rc != 0:
                rows.append(_row("GATE 1 on tonight's prices", True, "would block: " + S.telling_line(out), note=True))
        else:
            rows.append(_row("GATE 1 feed check runs", False, "data/prices.json is missing"))
        if issue.exists() and prices.exists():
            shutil.copy(issue, tmp / "daily.json")
            env = dict(env_today, FACT_CHECK_JSON=str(tmp / "no-fact-check.json"))
            for label, args in (("GATE 2 briefing gate", ["scripts/briefing_gate.py", str(tmp / "daily.json"), "--prices", str(tmp / "prices.json")]),
                                ("schema check", ["scripts/daily_schema.py", str(tmp / "daily.json")]),
                                ("GATE 2v number check", ["scripts/daily_retry.py", "prepublish", str(tmp / "daily.json")])):
                rc, out = _py(args, env)
                rows.append(_row(label + " runs", not _crash(rc, out), S.telling_line(out) if _crash(rc, out) else ""))
                if not _crash(rc, out) and rc != 0:
                    rows.append(_row(label + " on the last issue", True, "would hold it: " + S.telling_line(out), note=True))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return rows


def rehearse(day, env=None):
    base = dict(env if env is not None else os.environ)
    env_t = fake_env(day, base)
    env_today = {k: v for k, v in env_t.items() if k != "DAILY_FAKE_NOW"}
    rows = [check_clock(day, env_t)]
    if rows[0]["ok"]:
        rows += check_selftests(env_t)
        rows.append(check_inputs(env_t))
    rows.append(check_gate(day))
    rows += check_replays(env_t, env_today)
    return rows


def summary_md(day, rows):
    bad = [r for r in rows if not r["ok"]]
    notes = [r for r in rows if r["note"]]
    out = ["### Daily rehearsal for %s: %s" % (day, "%d of %d checks failed" % (len(bad), len(rows) - len(notes)) if bad
                                                 else "all %d checks passed" % (len(rows) - len(notes))), "",
           "Run tonight under tomorrow's clock (5:50 AM CT), send off, nothing published. The model is not called.", "",
           "| check | result | why |", "|---|---|---|"]
    for r in rows:
        out.append("| %s | %s | %s |" % (r["label"], "note" if r["note"] else ("pass" if r["ok"] else "FAIL"), r["line"].replace("|", "/")))
    return "\n".join(out) + "\n"


def mail_lines(day, rows):
    bad = [r for r in rows if not r["ok"]]
    d = date.fromisoformat(day)
    subject = "AGSIST Daily rehearsal: %d check%s would fail tomorrow morning (%s)" % (
        len(bad), "" if len(bad) == 1 else "s", d.strftime("%a %b ") + str(d.day))
    lines = ["Tonight's rehearsal ran the Daily's checks under tomorrow's clock (%s, 5:50 AM CT), with nothing sent or "
             "published. These failed:" % (d.strftime("%A %b ") + str(d.day)), ""]
    for r in bad:
        lines += [r["label"], "    " + (r["line"] or "(no output)"), ""]
    lines += ["A failing self-test no longer holds the Daily (Nov 3 rule): tomorrow's issue still goes out if its content "
              "checks pass. A failure in the gate, the generator's inputs or a content check can hold it: fix that tonight.",
              "The run's summary lists every check."]
    return subject, lines


def main(argv):
    day = None
    if "--date" in argv:
        i = argv.index("--date")
        day = argv[i + 1] if i + 1 < len(argv) else None
        date.fromisoformat(day)
    day = day or tomorrow_ct()
    print("Daily rehearsal for %s (clock %s)" % (day, fake_now(day)))
    rows = rehearse(day)
    import log_safe
    for r in rows:
        r["line"] = log_safe.mask_text(r["line"])
        print("%s  %s%s" % ("note" if r["note"] else ("ok  " if r["ok"] else "FAIL"), r["label"], (": " + r["line"]) if r["line"] else ""))
    text = summary_md(day, rows)
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        try:
            with open(p, "a", encoding="utf-8") as fh:
                fh.write(text)
        except OSError:
            pass
    bad = [r for r in rows if not r["ok"]]
    if not bad:
        print("rehearsal: all clear for %s" % day)
        return 0
    for r in bad:
        print("::error title=Daily rehearsal for %s::%s: %s" % (day, r["label"], r["line"]))
    if "--no-mail" not in argv:
        subject, lines = mail_lines(day, rows)
        print("rehearsal alert to Sig: " + ("sent" if log_safe.owner_mail(subject, lines) else "NOT sent (see above)"))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
