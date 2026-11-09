/* The Daily goes out on time (Nov 3 2026).
 * That morning the Daily went out two hours late, for two reasons:
 *  1. GATE 0g in daily.yml ran scripts/test_daily_numbers.py, a fixture check against live data, as a hard
 *     step in front of the generator. The live file moved, the test failed, and every morning run from
 *     5:46 to 7:31 CT (11:46Z to 13:31Z) stopped there. Today's issue was never the problem.
 *  2. At 7:32 CT a manual run without send_email published the issue and left a dry-run mark; the 7:46
 *     heartbeat read the mark as "done" and skipped, and nobody got the Daily until a manual send at 7:48.
 * Sig, Nov 3: code self-tests never hold the send; the Daily alerts him if not sent by 7:15 AM CT; a manual
 * run never marks the day done without sending; and the suite runs the night before under tomorrow's date.
 * Fixtures are the real Nov 3 job logs (test/fixtures/daily/2026-11-03-*.log), cut for size.
 *   node --test test/daily-safe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const wf = read(".github/workflows/daily.yml");
const CLEAN_ENV = (() => {
  const e = { ...process.env };
  for (const k of ["GITHUB_STEP_SUMMARY", "GITHUB_RUN_ID", "GH_TOKEN", "GITHUB_TOKEN", "GITHUB_REPOSITORY", "SMTP_USER",
                   "SMTP_PASS", "GMAIL_USER", "GMAIL_APP_PASS", "LIST_URL", "LIST_TOKEN", "LIST_SOURCE", "DAILY_FAKE_NOW"]) delete e[k];
  return e;
})();
const py = (args, env = {}) => spawnSync("python3", args, { cwd: ROOT, encoding: "utf8", env: { ...CLEAN_ENV, ...env } });
const job = (name) => {
  const a = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(a >= 0, `daily.yml has the job ${name}`);
  const rest = wf.slice(a + 1);
  const b = rest.search(/\n  [a-z][\w-]*:\n/);
  return b < 0 ? rest : rest.slice(0, b);
};
const steps = (text) => text.split(/\n      - /).slice(1).map((s) => "- " + s);
const live = (s) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

// ── 1. code self-tests report, they never hold the send ─────────────────────

test("Nov 3: the real GATE 0g failure is named by its telling line", () => {
  const out = py(["-c", `
import sys; sys.path.insert(0, "scripts")
import daily_selftests as S
print(S.telling_line(open("test/fixtures/daily/2026-11-03-gate0g-daily-numbers.log").read()))
print(S.telling_line("Traceback (most recent call last):\\n  File x\\nKeyError: '2026-10-12'\\n"))
print(S.telling_line("mail a@b.com failed: Error 5"))
`]);
  assert.equal(out.status, 0, out.stderr);
  const [a, b, c] = out.stdout.trim().split("\n");
  assert.match(a, /^FAIL\s+fixture matches data\/harvest-prices\.json Oct 12 to 16\s+-- \{'2026-10-09': None/);
  assert.equal(b, "KeyError: '2026-10-12'");
  assert.ok(!/a@b\.com/.test(c), "an address in a test's output is masked");
});

test("daily.yml: every code self-test runs in one report-only step; none is a hard step any more", () => {
  const gen = job("generate");
  const st = steps(gen).find((s) => s.startsWith("- name: Code self-tests (report only, never hold the send)"));
  assert.ok(st, "the self-test step");
  assert.match(st, /continue-on-error: true/);
  assert.match(st, /timeout-minutes: \d+/, "a hung test cannot hold the job either");
  assert.match(st, /run: python scripts\/daily_selftests\.py\n/);
  assert.match(st, /OWNER_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/);
  assert.ok(gen.indexOf("- name: Code self-tests") < gen.indexOf("- name: GATE 1"), "reported before the issue is written");
  // the general rule: in the job that sends, a step that runs a test or a selftest never stops the job
  const TESTY = /(scripts\/test_\w+\.py|--selftest\b|scripts\/(contract_calendar|market_board)\.py\s*$)/m;
  for (const s of steps(gen)) {
    const body = live(s.slice(s.indexOf("\n")));
    if (!TESTY.test(body) || /^python3 scripts\/test_send_loops\.py$/m.test(body.replace(/^\s*run: /m, "").trim())) continue;
    assert.match(s, /continue-on-error: true/, `a self-test in a hard step: ${s.split("\n")[0]}`);
  }
  // every command the old GATE 0 to 0g and the content steps ran is still run, from the one list
  const list = read("scripts/daily_selftests.py");
  for (const c of ["scripts/test_preflight_limits.py", '"scripts/briefing_cut.py", "--selftest"', "scripts/contract_calendar.py",
                   "scripts/market_board.py", "scripts/test_number_binding.py", "scripts/test_arc_plc_link.py",
                   '"scripts/voice_lint.py", "--selftest"', '"scripts/report_day.py", "--selftest"', '"scripts/usda_dates.py", "--selftest"',
                   "scripts/test_daily_trust.py", '"scripts/watch_dates.py", "--selftest"', '"scripts/streak_words.py", "--selftest"',
                   "scripts/test_daily_numbers.py", '"scripts/daily_claims.py", "--selftest"', "scripts/test_fact_check.py",
                   '"scripts/headline_fix.py", "--selftest"', '"scripts/cause_fix.py", "--selftest"', '"scripts/daily_edge.py", "--selftest"',
                   "scripts/test_daily_clock.py", "scripts/test_daily_memory.py"]) assert.ok(list.includes(c), `still run: ${c}`);
  // the one exception: the send-loop guard stays a hard step right before the send (it stops a double or mass send)
  assert.ok(!list.includes('["scripts/test_send_loops.py"]'), "the send-loop guard is not report-only");
  const sl = steps(gen).find((x) => x.startsWith("- name: Neither send loop can re-mail the whole list"));
  assert.ok(sl, "the send-loop guard step");
  assert.match(sl, /run: python3 scripts\/test_send_loops\.py/);
  assert.doesNotMatch(sl, /continue-on-error/, "a failing send-loop guard holds the email");
  assert.match(sl, /if: \$\{\{ github\.event_name == 'schedule' \|\| inputs\.send_email == true \}\}/);
  assert.ok(gen.indexOf("- name: Neither send loop") > gen.indexOf("- name: Commit and push") &&
            gen.indexOf("- name: Neither send loop") < gen.indexOf("- name: Send daily email"), "right before the send");
  // and the content gates on today's issue still hold it: hard steps, in order, before the commit
  for (const [name, cmd] of [["GATE 1", "python scripts/preflight_prices.py data/prices.json --repair"],
                             ["GATE 2f", "python scripts/fact_check_briefing.py"],
                             ["GATE 2h", "python scripts/headline_fix.py data/daily.json --prices data/prices.json"],
                             ["GATE 2 ", "python scripts/briefing_gate.py data/daily.json --prices data/prices.json"],
                             ["Validate schema", "python scripts/daily_schema.py data/daily.json"],
                             ["GATE 2v", "python scripts/daily_retry.py prepublish"]]) {
    const s = steps(gen).find((x) => x.startsWith(`- name: ${name}`));
    assert.ok(s && s.includes(cmd), `${name} runs ${cmd}`);
    assert.doesNotMatch(s, /continue-on-error/, `${name} still holds the issue`);
    assert.ok(gen.indexOf(cmd) < gen.indexOf("- name: Commit and push"));
  }
});

test("the self-test runner: a failing test reports, lists every test, mails once a day, and exits 1", () => {
  const out = py(["-c", `
import sys, json, os, tempfile
sys.path.insert(0, "scripts")
import daily_selftests as S, daily_retry as R
d = tempfile.mkdtemp()
open(os.path.join(d, "ok.py"), "w").write("print('fine')\\n")
open(os.path.join(d, "bad.py"), "w").write(open("test/fixtures/daily/2026-11-03-gate0g-daily-numbers.log").read().replace("\\\\", "/").join(["print('''", "''')\\nraise SystemExit(1)\\n"]))
S.REPO = __import__("pathlib").Path(d)
res = S.run_all(tests=[("GATE 0b word budget", ["ok.py"], {}), ("GATE 0g daily numbers", ["bad.py"], {}), ("gone", ["missing.py"], {})], echo=False)
print(json.dumps([(r["label"], r["ok"]) for r in res]))
md = S.summary_md(res)
print(md.splitlines()[0])
print("never hold" in md, "| GATE 0g daily numbers | FAIL | FAIL  fixture matches data/harvest-prices.json" in md)
subj, lines = S.mail_lines("2026-11-03", [r for r in res if not r["ok"]])
print(subj)
print("—" in subj + "".join(lines), "@" in "".join(lines))
# the cap, from today's runs (fields the API returns)
def fetcher(runs, fail=False):
    def f(path):
        if fail: raise R.NoHistory("the runs could not be read (HTTPError)")
        if path.startswith("/actions/workflows/daily.yml/runs"):
            return {"workflow_runs": [{k: v for k, v in r.items() if k != "_jobs"} for r in runs]}
        rid = int(path.split("/")[3]); return next(r["_jobs"] for r in runs if r["id"] == rid)
    return f
def run(i, z, concl):
    return {"id": i, "created_at": "2026-11-03T%sZ" % z, "event": "workflow_dispatch", "conclusion": "success",
            "_jobs": {"jobs": [{"name": "generate", "steps": [{"name": S.STEP_NAME, "conclusion": concl}]}]}}
print("first", S.may_mail("2026-11-03", fetcher([run(1, "11:46:18", "success")]), this_run=2))
print("second", S.may_mail("2026-11-03", fetcher([run(1, "11:46:18", "failure")]), this_run=2))
print("self", S.may_mail("2026-11-03", fetcher([run(2, "11:46:18", "failure")]), this_run=2))
print("unreadable", S.may_mail("2026-11-03", fetcher([], fail=True), this_run=2))
`]);
  assert.equal(out.status, 0, out.stderr);
  const o = out.stdout.split("\n");
  assert.deepEqual(JSON.parse(o[0]), [["GATE 0b word budget", true], ["GATE 0g daily numbers", false], ["gone", false]]);
  assert.equal(o[1], "### Daily code self-tests: 1 of 3 passed");
  assert.equal(o[2], "True True");
  assert.equal(o[3], "AGSIST Daily 2026-11-03: 2 code self-tests failed; the Daily still goes out");
  assert.equal(o[4], "False False", "no em dash, no address");
  assert.ok(o.includes("first True") && o.includes("second False") && o.includes("self True") && o.includes("unreadable True"), out.stdout);
});

// ── 2. not sent by 7:15 AM CT: one email to Sig, naming the step ───────────

// Nov 3 2026's daily.yml runs as the API returned them (UTC; CST = UTC-6), and the real logs.
const NOV3 = `
import json, os, sys, tempfile
sys.path.insert(0, "scripts")
import daily_late as L, daily_retry as R
GEN = open("test/fixtures/daily/2026-11-03-0546-generate-job.log").read()
GATE = open("test/fixtures/daily/2026-11-03-0746-gate-job.log").read()
T = lambda s: "Generate Daily Briefing (manual, %s)" % s
HB = T("send_email=true, heartbeat=true, test_to_sig=false")
def run(i, z, concl, title=HB, failed=None):
    jobs = [{"id": i * 10, "name": "gate", "steps": [{"name": "Run python3 gate", "conclusion": "success"}]}]
    if failed:
        jobs.append({"id": i * 10 + 1, "name": "generate", "steps": [{"name": "Checkout", "conclusion": "success"},
                     {"name": failed, "conclusion": "failure"}]})
    return {"id": i, "created_at": "2026-11-03T%sZ" % z, "event": "workflow_dispatch", "status": "completed",
            "conclusion": concl, "display_title": title, "_jobs": {"jobs": jobs}}
G0G = "GATE 0g - holiday week, week-ahead label, byline, acronyms"
RUNS = [run(41626142049, "11:16:16", "success")] + [run(41630198600 + k, z, "failure", failed=G0G) for k, z in
        enumerate(["11:46:18", "12:01:24", "12:16:17", "12:31:19", "12:46:21", "13:01:26", "13:16:17"])]
def fetcher(runs, fail=False):
    def f(path):
        if fail: raise R.NoHistory("the runs could not be read (HTTPError)")
        if path.startswith("/actions/workflows/daily.yml/runs"):
            return {"workflow_runs": [{k: v for k, v in r.items() if k != "_jobs"} for r in runs]}
        rid = int(path.split("/")[3]); return next(r["_jobs"] for r in runs if r["id"] == rid)
    return f
def text(path):
    jid = int(path.split("/")[3])
    return GEN if jid % 10 == 1 else GATE
sent = []
mail = lambda s, l: sent.append([s, l]) or True
root = tempfile.mkdtemp(); os.makedirs(os.path.join(root, "data", "daily-sent"))
`;

test("Nov 3 at 7:16 CT: not sent, so Sig gets one email naming GATE 0g and its FAIL line", () => {
  const out = py(["-c", NOV3 + `
os.environ["GITHUB_REPOSITORY"] = "dnilgis/agsist"
rc = L.check("2026-11-03T07:16:00-06:00", root, flag=lambda d: 0, fetch=fetcher(RUNS), text=text, mail=mail, wf_text="")
print("RESULT", json.dumps([rc, sent]))
`]);
  assert.equal(out.status, 0, out.stderr);
  const [rc, sent] = JSON.parse(out.stdout.split("RESULT ")[1]);
  assert.equal(rc, 0);
  assert.equal(sent.length, 1);
  const [subj, lines] = sent[0];
  assert.equal(subj, "AGSIST Daily 2026-11-03 not sent by 7:15 AM CT");
  const body = lines.join("\n");
  assert.match(body, /^The Daily for Tuesday Nov 3 has not gone to the list, and it is 7:16 AM CT\./);
  assert.match(body, /Sent: not sent \(no sent copy on main, and the day flag says it never went to the list\)/);
  assert.match(body, /Daily runs today: 8 \(7 failed\)/);
  assert.match(body, /Failing step: GATE 0g - holiday week, week-ahead label, byline, acronyms, in the heartbeat at 7:16 CT\. https:\/\/github\.com\/dnilgis\/agsist\/actions\/runs\/41630198606/);
  assert.match(body, /Log line: FAIL\s+fixture matches data\/harvest-prices\.json Oct 12 to 16/);
  assert.match(body, /Run workflow on main with send_email ticked/);
  assert.ok(!/@|—/.test(subj + body), "no address and no em dash in the email");
  assert.match(out.stdout, /::error title=Daily not sent by 7:15 AM CT::/);
});

test("Nov 3 sequence: the 7:32 dry run and the 7:46 gate skip are named; sent, flagged, early or late runs mail nothing", () => {
  const out = py(["-c", NOV3 + `
dry = run(41645271589, "13:32:43", "success", title=T("send_email=false, heartbeat=false, test_to_sig=false"))
beat = run(41647339154, "13:46:25", "success")
d = L.diagnose("2026-11-03", fetcher(RUNS + [dry, beat]), text, "", "dnilgis/agsist")
print("DIAG", json.dumps(d))
for label, now, kw in [("early", "2026-11-03T07:14:00-06:00", {}), ("other-tick", "2026-11-03T08:16:00-06:00", {}),
                       ("cdt-tick", "2026-10-09T07:15:30-05:00", {})]:
    sent.clear(); L.check(now, root, flag=lambda d: 0, fetch=fetcher([]), text=text, mail=mail, wf_text="")
    print(label, len(sent))
sent.clear(); L.check("2026-11-03T07:20:00-06:00", root, flag=lambda d: 1, fetch=fetcher(RUNS), text=text, mail=mail, wf_text="")
print("flag-set", len(sent))
sent.clear(); L.check("2026-11-03T07:20:00-06:00", root, flag=lambda d: 2, fetch=fetcher(RUNS), text=text, mail=mail, wf_text="")
print("flag-unreadable", len(sent), "could not be read" in sent[0][1][1])
open(os.path.join(root, "data", "daily-sent", "2026-11-03.json"), "w").write("{}")
sent.clear(); L.check("2026-11-03T07:20:00-06:00", root, flag=lambda d: 0, fetch=fetcher(RUNS), text=text, mail=mail, wf_text="")
print("sent-copy", len(sent))
print("none", json.dumps(L.diagnose("2026-11-03", fetcher([]), text, "", "")))
print("unreadable", json.dumps(L.diagnose("2026-11-03", fetcher([], fail=True), text, "", "")))
`]);
  assert.equal(out.status, 0, out.stderr);
  const d = JSON.parse(out.stdout.split("DIAG ")[1].split("\n")[0]).join("\n");
  assert.match(d, /Newest: heartbeat at 7:46 CT, success\./);
  assert.match(d, /A manual run without send_email published today's issue at 7:32 CT and emailed nobody\./);
  assert.match(d, /The gate's last word: 07:46 Central: SKIPPING: 2026-11-03 was published by a manual run without send_email/);
  assert.match(d, /Failing step: GATE 0g/);
  const o = out.stdout;
  assert.match(o, /^early 0$/m, "7:14 is not late");
  assert.match(o, /^other-tick 0$/m, "the second UTC tick is outside the alert hour: one email a day");
  assert.match(o, /^cdt-tick 1$/m, "7:15 CDT alerts too");
  assert.match(o, /^flag-set 0$/m, "the list got it; only the copy is missing");
  assert.match(o, /^flag-unreadable 1 True$/m);
  assert.match(o, /^sent-copy 0$/m);
  assert.match(o, /^none \["No run of the Daily has started today/m);
  assert.match(o, /^unreadable \["Today's Daily runs could not be read/m);
});

test("cron-health.yml runs the late check once, after the 7:15 tick in either season, and reads only", () => {
  const ch = read(".github/workflows/cron-health.yml");
  assert.match(ch, /- id: late\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n\s+run: >-\n\s+python3 scripts\/cron_gate\.py tick --workflow cron-health\.yml --max-lag 45\n\s+--cron "15 12,13 \* \* \*"/);
  assert.match(ch, /late: \$\{\{ steps\.late\.outputs\.go \}\}/);
  const j = ch.slice(ch.indexOf("\n  daily-late:\n"), ch.indexOf("\n  check:\n"));
  assert.match(j, /if: needs\.gate\.outputs\.late == '1'/);
  assert.match(j, /permissions:\n\s+contents: read\n\s+actions: read/);
  assert.match(j, /run: python3 scripts\/daily_late\.py check/);
  assert.match(j, /OWNER_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/);
  assert.ok(!/git (commit|push)|push_raw/.test(j), "it writes nothing");
  // one of 12:15 and 13:15 UTC is 7:15 Central in both seasons; the other lands outside 7:15-8:15
  const out = py(["-c", `
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
for day in ("2026-07-15", "2026-11-03", "2027-01-15", "2027-03-15"):
    hits = [h for h in (12, 13) if (lambda t: (7, 15) <= (t.hour, t.minute) < (8, 15))(
        datetime.fromisoformat(day + "T%02d:15:00+00:00" % h).astimezone(ZoneInfo("America/Chicago")))]
    print(day, hits)
`]);
  assert.equal(out.status, 0, out.stderr);
  for (const l of out.stdout.trim().split("\n")) assert.match(l, /\[(12|13)\]$/, l);
  // cron_health's own clock is still its first tick step
  const c = py(["-c", `import sys; sys.path.insert(0, "scripts"); import cron_health as C; print(C.gate_crons("cron-health.yml"))`]);
  assert.equal(c.stdout.trim(), "['26,56 * * * *']");
});

// ── 4. tomorrow's Daily, rehearsed the evening before ──────────────────────

test("tomorrow's clock: every clock the Daily reads moves, and nothing moves without it", () => {
  const code = `
import datetime as D, time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
n = datetime.now(ZoneInfo("America/Chicago"))
print(date.today(), n.strftime("%H:%M %z"), time.strftime("%Y-%m-%d"), datetime.utcnow().strftime("%Y-%m-%dT%H:%M"),
      isinstance(D.date(2027, 1, 1), date), isinstance(datetime.now().date(), date), type(datetime.now() + timedelta(1)).__name__)
`;
  const fake = py(["-c", code], { PYTHONPATH: "scripts/daily_clock", DAILY_FAKE_NOW: "2026-12-31T23:59:00-06:00", TZ: "America/Chicago" });
  assert.equal(fake.status, 0, fake.stderr);
  assert.equal(fake.stdout.trim(), "2026-12-31 23:59 -0600 2026-12-31 2027-01-01T05:59 True True datetime");
  // no date in this check (Nov 3 rule): without DAILY_FAKE_NOW the real classes and the real time.time are left in place
  const real = py(["-c", "import datetime as D, time; print(type(D.date) is type and type(D.datetime) is type and time.time.__module__ == 'time')"], { PYTHONPATH: "scripts/daily_clock" });
  assert.equal(real.stdout.trim(), "True", "without DAILY_FAKE_NOW the shim does nothing");
});

test("the rehearsal: tomorrow at 5:50 CT in either season, a test that breaks tomorrow fails tonight, and Sig is told", () => {
  const out = py(["-c", `
import sys, json, os, tempfile
sys.path.insert(0, "scripts")
import daily_rehearsal as H, daily_selftests as S
from datetime import datetime
from zoneinfo import ZoneInfo
print(H.fake_now("2026-11-04"), H.fake_now("2026-03-09"), H.fake_now("2026-11-01"))
print(H.tomorrow_ct(datetime(2026, 11, 2, 18, 41, tzinfo=ZoneInfo("America/Chicago"))),
      H.tomorrow_ct(datetime(2026, 12, 31, 18, 41, tzinfo=ZoneInfo("America/Chicago"))))
# a self-test with a date in it, the way the Nov 3 one compared a fixture with a file that moved on
d = tempfile.mkdtemp()
t = os.path.join(d, "datebound.py")
open(t, "w").write("from datetime import date\\nimport sys\\nif date.today() >= date(2026, 11, 3):\\n    print('  FAIL  fixture window ends Nov 2'); sys.exit(1)\\nprint('ok')\\n")
S.SELFTESTS = [("GATE 0g daily numbers", [t], {})]
env = H.fake_env("2026-11-03", {k: v for k, v in os.environ.items()})
rows = [H.check_clock("2026-11-03", env)] + H.check_selftests(env)
print(json.dumps([(r["label"], r["ok"], r["line"]) for r in rows]))
print("ANTHROPIC_API_KEY" in env, "SMTP_PASS" in env, env["TZ"])
rows.append(H._row("GATE 2 briefing gate on the last issue", True, "would hold it: RESULT: BLOCK", note=True))
md = H.summary_md("2026-11-03", rows)
print(md.splitlines()[0])
s, l = H.mail_lines("2026-11-03", rows)
print(s)
print("FAIL  fixture window ends Nov 2" in "\\n".join(l), "—" in s + "".join(l), "@" in "".join(l))
`]);
  assert.equal(out.status, 0, out.stderr);
  const o = out.stdout.trim().split("\n");
  assert.equal(o[0], "2026-11-04T05:50:00-06:00 2026-03-09T05:50:00-05:00 2026-11-01T05:50:00-06:00");
  assert.equal(o[1], "2026-11-03 2027-01-01");
  assert.deepEqual(JSON.parse(o[2]), [["tomorrow's clock takes", true, ""], ["self-test: GATE 0g daily numbers", false, "FAIL  fixture window ends Nov 2"]]);
  assert.equal(o[3], "False False America/Chicago", "no model key and no mail login reach the rehearsed code");
  assert.equal(o[4], "### Daily rehearsal for 2026-11-03: 1 of 2 checks failed");
  assert.equal(o[5], "AGSIST Daily rehearsal: 1 check would fail tomorrow morning (Tue Nov 3)");
  assert.equal(o[6], "True False False");
});

test("the rehearsal's gate check runs daily.yml's real gate for tomorrow", () => {
  const out = py(["-c", `
import sys; sys.path.insert(0, "scripts")
import daily_rehearsal as H
print(H.check_gate("2026-11-04"))
`]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /'ok': True/);
});

test("cron-health.yml rehearses every evening after the 00:41 UTC tick, send off, nothing written", () => {
  const ch = read(".github/workflows/cron-health.yml");
  assert.match(ch, /- id: rehearse\n\s+env:\n\s+GH_TOKEN: \$\{\{ github\.token \}\}\n\s+run: >-\n\s+python3 scripts\/cron_gate\.py tick --workflow cron-health\.yml --max-lag 45\n\s+--cron "41 0 \* \* \*"/);
  assert.match(ch, /rehearse: \$\{\{ steps\.rehearse\.outputs\.go \}\}/);
  const j = ch.slice(ch.indexOf("\n  daily-rehearsal:\n"), ch.indexOf("\n  check:\n"));
  assert.match(j, /if: needs\.gate\.outputs\.rehearse == '1'/);
  assert.match(j, /permissions:\n\s+contents: read\n/);
  assert.match(j, /run: python scripts\/daily_rehearsal\.py\n/);
  assert.match(j, /OWNER_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/);
  assert.ok(!/ANTHROPIC|LIST_URL|LIST_TOKEN|RECIPIENTS|git (commit|push)|push_raw|send_daily/.test(j), "no model key, no list, no writes, no send");
  // cron-job.org's chain wakes this workflow every evening; the GitHub cron stays its fallback
  assert.match(ch, /workflow_run:\n\s+workflows: \["Fetch Grain Bids"\]/);
});

// ── Nov 10 2026: the two lines a ZIP reader got word for word every day ─────
test("a ZIP reader's land line and rain record words print only when their fact entered or moved (Nov 5 to 10 repeats)", () => {
  const out = py(["scripts/test_daily_zip_lines.py"]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /test_daily_zip_lines: 0 failure\(s\)/);
  assert.doesNotMatch(out.stdout, /^FAIL /m);
  assert.ok(read("scripts/daily_selftests.py").includes('["scripts/test_daily_zip_lines.py"]'), "in the Daily's self-test list");
});
