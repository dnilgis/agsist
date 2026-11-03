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
    if (!TESTY.test(body)) continue;
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
                   "scripts/test_send_loops.py"]) assert.ok(list.includes(c), `still run: ${c}`);
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
