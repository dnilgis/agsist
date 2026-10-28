/* A blocked Daily retries itself (2026-10-28).
 * That morning the 6:16 a.m. CT run passed the fact check, committed and
 * published the issue, and then the send step's number check (daily_v2.check
 * through send_daily.v2_gate) refused it. Every later run said "already
 * published" and skipped; nobody got the Daily until a manual run, and the
 * refused headline was live on /daily for about two hours.
 *
 * The fixture is the real 6:16 issue (data/daily-archive/2026-10-28.json as
 * that run committed it). Its headline, "Corn is at $4.51½ after four lower
 * closes", passes since PR #132 (a count of closes after the price is history,
 * not a label), so the true block is built from it the way the error reads:
 * "Corn closed at $4.51½", with the morning's own locked_changes (the 6:16 last
 * trade 4.515 against the 4.4875 settle).
 *   node --test test/daily-retry.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const FIX = join(ROOT, "test/fixtures/daily/2026-10-28-0616-published.json");
const wf = read(".github/workflows/daily.yml");

const CLEAN_ENV = (() => {
  const e = { ...process.env };
  for (const k of ["RUNNER_TEMP", "FACT_CHECK_JSON", "DAILY_FORMAT", "LIST_URL", "LIST_TOKEN", "LIST_SOURCE",
                   "SMTP_USER", "SMTP_PASS", "GMAIL_USER", "GMAIL_APP_PASS", "PRINT_OF_DAY", "TEST_TO_SIG", "DRY_RUN"]) delete e[k];
  return e;
})();
const py = (args, env = {}) => spawnSync("python3", args, { cwd: ROOT, encoding: "utf8", env: { ...CLEAN_ENV, ...env } });
const step = (name) => {
  const i = wf.indexOf(`- name: ${name}`);
  assert.ok(i >= 0, `daily.yml has the step "${name}"`);
  const rest = wf.slice(i + 1);
  const j = rest.search(/\n      - name: /);
  return j < 0 ? rest : rest.slice(0, j);
};

function closedIssue(dir) {
  const d = JSON.parse(readFileSync(FIX, "utf8"));
  d.headline = "Corn closed at $4.51½ after four lower closes; hogs fell 4.1%";
  d.lead = "Dec corn closed at $4.51½ after four lower closes, with a fast harvest piling bushels on a market that was already heavy.";
  const f = join(dir, "2026-10-28.json");
  writeFileSync(f, JSON.stringify(d));
  return f;
}

test("Oct 28: a draft the send would refuse is stopped before publishing (GATE 2v)", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-"));
  try {
    const nofc = { DAILY_FORMAT: "v2", FACT_CHECK_JSON: join(dir, "none.json") };
    const bad = py(["scripts/daily_retry.py", "prepublish", closedIssue(dir)], nofc);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /headline: "Corn closed at \$4\.51½ after four lower closes" says close or settle, but \$4\.51½ is the 6:16 a\.m\. CT last trade; the settle was \$4\.48¾/);
    assert.match(bad.stdout, /GATE 2v: the send would refuse this issue, so it is not published\. The next run writes it again/);
    // the real 6:16 issue passes (PR #132), so the gate is not a blanket stop
    const ok = py(["scripts/daily_retry.py", "prepublish", FIX], nofc);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /clear to publish/);
    // the old format does not run the v2 check at the send, so not here either
    const cur = py(["scripts/daily_retry.py", "prepublish", closedIssue(dir)], { ...nofc, DAILY_FORMAT: "current" });
    assert.equal(cur.status, 0, cur.stdout);
    assert.match(cur.stdout, /does not apply/);
    // the saved fact check counts as it does at the send: a verified high finding on the lead holds the issue
    const fc = join(dir, "fact-check.json");
    writeFileSync(fc, JSON.stringify({ findings: [{ field: "lead", kind: "mismatch", severity: "high", verified: true,
      quote: "Dec corn is at $4.51½", expected: "$4.4875 settle" }] }));
    const held = py(["scripts/daily_retry.py", "prepublish", FIX], { DAILY_FORMAT: "v2", FACT_CHECK_JSON: fc });
    assert.equal(held.status, 1, held.stdout);
    assert.match(held.stdout, /fact check high mismatch/);
    assert.ok(!/@/.test(bad.stdout + held.stdout), "no address in the public log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daily.yml runs GATE 2v after GATE 2 and the schema, before the commit, as a hard step; the send keeps its check", () => {
  const g2v = wf.indexOf("python scripts/daily_retry.py prepublish");
  const g2 = wf.indexOf("python scripts/briefing_gate.py data/daily.json");
  const schema = wf.indexOf("python scripts/daily_schema.py data/daily.json");
  const commit = wf.indexOf("- name: Commit and push");
  const send = wf.lastIndexOf("run: python scripts/send_daily.py");   // the generate job's send (test-to-sig has one earlier)
  assert.ok(g2 > 0 && schema > g2 && g2v > schema && commit > g2v && send > commit, "order");
  const s = step("GATE 2v, the email's number check before publishing");
  assert.doesNotMatch(s, /continue-on-error/);
  assert.doesNotMatch(s, /^\s+if:/m, "it runs on every run that can publish, dry runs included");
  assert.ok(s.includes("DAILY_FORMAT: ${{ inputs.format || vars.DAILY_FORMAT || 'v2' }}"), "the same format the send reads");
  // the same function: prepublish goes through send_daily.v2_gate, which calls daily_v2.check
  const dr = read("scripts/daily_retry.py");
  assert.match(dr, /sd\.v2_gate\(day, b, alert=False\)/);
  assert.match(read("scripts/send_daily.py"), /bad, notes = daily_v2\.check\(b, built\)/);
  assert.match(read("scripts/send_daily.py"), /if not v2_gate\(day, b, alert=not \(dry or test\)\):/, "belt and braces: the send still checks");
});

test("a block mails Sig which check held it and that the next run tries again", () => {
  const out = py(["-c", `
import sys, json
sys.path.insert(0, "scripts")
import daily_retry as R
from datetime import datetime
s, l = R.alert_lines("2026-10-28", ["g2v"], datetime(2026, 10, 28, 6, 17))
print(json.dumps([s, l]))
s, l = R.alert_lines("2026-10-28", ["g2f"], datetime(2026, 10, 28, 14, 5))
print(json.dumps([s, l]))
print(json.dumps(R.alert_lines("2026-10-28", ["g2h"], datetime(2026, 10, 28, 6, 17))))
print(json.dumps(R.alert_lines("2026-10-28", ["unknown"], datetime(2026, 10, 28, 6, 17))[0]))
sent = []
R.alert(["", "g2v", ""], datetime(2026, 10, 28, 6, 17), mail=lambda s, l: sent.append(s) or True)
print(json.dumps(sent))
`]);
  assert.equal(out.status, 0, out.stderr);
  const [a, b, c, d, e] = out.stdout.trim().split("\n").filter((x) => x.startsWith("[") || x.startsWith('"') || x === "null").map((x) => JSON.parse(x));
  assert.equal(a[0], "AGSIST Daily 2026-10-28 held by the email's number check on the subject, headline and lead (GATE 2v); the next run tries again");
  const body = a[1].join("\n");
  assert.match(body, /Nothing was published and nothing went to the list/);
  assert.match(body, /The next scheduled run tries again on its own/);
  assert.match(body, /until 2 p\.m\. CT/);
  assert.match(b[0], /held by the fact check against the source data \(GATE 2f\)$/);
  assert.match(b[1].join("\n"), /no scheduled run tries again today[\s\S]*send_email ticked/);
  assert.deepEqual(c, [null, null], "GATE 2h mails its own alert; not twice");
  assert.match(d, /held by a check; the next run tries again/);
  assert.equal(e.length, 1);
  for (const t of [a, b]) assert.ok(!/—/.test(JSON.stringify(t)), "no em dash in copy Sig reads");
});

test("daily.yml: the alert follows the commit, only for a run meant for the list, naming every gate step by id", () => {
  const s = step("Tell Sig which check held the Daily");
  assert.ok(wf.indexOf("- name: Tell Sig which check held the Daily") > wf.indexOf("- name: Commit and push"));
  assert.ok(wf.indexOf("- name: Tell Sig which check held the Daily") < wf.indexOf("- name: Send daily email"));
  assert.match(s, /if: \$\{\{ failure\(\) && steps\.commit\.outcome != 'success' && \(github\.event_name == 'schedule' \|\| inputs\.send_email == true\) \}\}/);
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /OWNER_TO:\s+\$\{\{ secrets\.SIG_TO \}\}/);
  const R = read("scripts/daily_retry.py");
  for (const id of ["g1", "gen", "g2f", "g2h", "g2", "schema", "g2v", "commit"]) {
    assert.match(wf, new RegExp(`\\n        id: ${id}\\n`), `step id ${id}`);
    assert.ok(s.includes(`steps.${id}.outcome == 'failure' && '${id}'`), `FAILED names ${id}`);
    assert.match(R, new RegExp(`"${id}": "`), `daily_retry names ${id} for Sig`);
  }
  // the send-time hold says the same thing
  const sd = read("scripts/send_daily.py");
  assert.match(sd, /The next scheduled run tries again on its own \(until 2 p\.m\. CT\)/);
});

test("the gate: published means published and sent; it asks the day flag before writing an unsent issue again", () => {
  const r = spawnSync("python3", ["scripts/test_daily_schedule.py"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout.slice(-3000) + r.stderr);
  for (const line of [
    "a published issue that never went out is written again in the morning, after asking the day flag",
    "…by the price loop's heartbeat too",
    "but not when the day flag says it went out (only the sent copy is missing)",
    "and not when the day flag cannot be read: never risk a second send",
    "a manual run without send_email publishes on purpose; the morning does not mail it",
    "past the 14:00 morning window an unsent issue is left alone",
    "a day with its sent copy skips without asking the flag",
  ]) assert.ok(r.stdout.includes("  ok    " + line), line);
  // the gate job can read the flag: the engine is in place and the list secrets are there, read only
  const gate = wf.slice(wf.indexOf("\n  gate:\n"), wf.indexOf("\n  generate:\n"));
  assert.match(gate, /permissions:\n\s+contents: read/);
  assert.match(gate, /LIST_URL:\s+\$\{\{ secrets\.LIST_URL \}\}/);
  assert.match(gate, /LIST_TOKEN:\s+\$\{\{ secrets\.LIST_TOKEN \}\}/);
  assert.match(gate, /uses: \.\/\.github\/actions\/engine/);
  assert.ok(!/SMTP_|send_daily\.py/.test(gate.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")), "the gate never mails");
});

test("the day flag: 0 only when it definitely did not go out; anything unclear is 'cannot tell'", () => {
  const out = py(["-c", `
import os, sys
sys.path.insert(0, "scripts")
import daily_retry as R, list_source as L
print(R.flag_state("2026-10-28"))
os.environ.update({"LIST_URL": "https://subs.invalid", "LIST_TOKEN": "t"})
for v in (True, False, RuntimeError("down"), L.Unavailable("neither place")):
    def f(k, _v=v):
        assert k == "briefed:2026-10-28", k
        if isinstance(_v, Exception):
            raise _v
        return _v
    L.flag_is_set = f
    print(R.flag_state("2026-10-28"))
`]);
  assert.equal(out.status, 0, out.stderr);
  const codes = out.stdout.trim().split("\n").filter((l) => /^\d$/.test(l));
  assert.deepEqual(codes, ["2", "1", "0", "2", "2"], out.stdout);
  assert.ok(!/token|t@|@/.test(out.stdout.replace(/briefed:/g, "")), "no token or address printed");
});

test("a dry run's mark: kept once, not over a real send, no reader data", () => {
  const dir = mkdtempSync(join(tmpdir(), "mark-"));
  try {
    const out = py(["-c", `
import sys, json, os
sys.path.insert(0, "scripts")
import daily_retry as R
d = sys.argv[1]
p = R.dry_run_mark("2026-10-28", d)
print(json.dumps(sorted(json.load(open(p)))))
open(os.path.join(d, "2026-10-29.json"), "w").write("{}")
print(R.dry_run_mark("2026-10-29", d))
`, dir]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /\["at", "date", "note"\]/);
    assert.match(out.stdout, /2026-10-29 already went to the list; no mark needed\nNone/);
    assert.ok(existsSync(join(dir, "2026-10-28.dry-run.json")) && !existsSync(join(dir, "2026-10-29.dry-run.json")));
    assert.ok(!/@/.test(readFileSync(join(dir, "2026-10-28.dry-run.json"), "utf8")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const s = step("Mark a dry run as deliberately not sent");
  assert.ok(wf.indexOf("- name: Mark a dry run as deliberately not sent") > wf.lastIndexOf("run: python scripts/send_daily.py"));
  assert.match(s, /steps\.commit\.outcome == 'success' && github\.event_name != 'schedule' && inputs\.send_email != true/);
  assert.match(s, /continue-on-error: true/);
  assert.match(s, /git add "data\/daily-sent\/\$d\.dry-run\.json"/);
  // a heartbeat carries send_email=true, so a price-loop run never marks the day
  assert.match(read(".github/workflows/prices.yml"), /send_email=true/);
});

test("review: a day flag that could not be set reads as not set, so the send sets it again after the list", () => {
  const out = py(["-c", `
import os, sys
sys.path.insert(0, "scripts")
import send_daily as S, list_source as L
os.environ.update({"LIST_URL": "https://subs.invalid", "LIST_TOKEN": "t"})
def boom(k):
    raise L.Unavailable("worker down and the private repo not saved")
L.flag_set = boom
print("set", S.flag("2026-10-28", set_it=True))
L.flag_is_set = boom
print("read", S.flag("2026-10-28"))
`]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^set False$/m, "a failed set is not 'flagged'");
  assert.match(out.stdout, /^read True$/m, "a failed read still fails closed (already sent)");
  assert.match(read("scripts/send_daily.py"), /flagged = flag\(day, set_it=True\) is True/);
});
