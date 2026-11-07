/* The monthly emails, the ARC/PLC reminder and county rain always run (Sig, Nov 2 2026: "yes i want
 * reliable email delivery"). GitHub's scheduler never started rain-monthly.yml or county-rain.yml on
 * Nov 2, so each of the four also runs after every "Fetch Grain Bids" (cron-job.org, every 15 minutes)
 * and a cron_gate.py tick step, carrying the workflow's own cron, lets one run per tick do the work.
 *   - each runs on workflow_run after Fetch Grain Bids, its schedule unchanged;
 *   - the gate step carries exactly the schedule's crons and a justified max-lag;
 *   - every working job waits for the gate and runs only on go;
 *   - a chained run takes the scheduled send path; a run by hand keeps its own inputs, dry by default;
 *   - a run by hand does not use up the tick (cron_gate.py), and cron_health watches the gate clock.
 *
 *   node --test test/mail-gated.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// workflow, its schedule (unchanged), the gate's max-lag, and the longest the lag may be
const FLOWS = [
  ["rain-monthly.yml", ["41 14 2 * *"], 360, "the same afternoon in Central"],
  ["land-alert.yml", ["47 15 3 * *"], 360, "the same afternoon in Central"],
  ["arcplc-reminder.yml", ["10 14,17,20 * 11,12,2,3 *"], 170, "closes before the next tick, three hours on"],
  ["county-rain.yml", ["23 13 * * *", "41 14 2 1 *"], 720, "the same Central day, never into the next day's tick"],
];

const job = (wf, name) => {
  const i = wf.indexOf("\n  " + name + ":\n");
  assert.ok(i > 0, "job " + name);
  const rest = wf.slice(i + 1);
  const next = rest.slice(1).search(/\n  [a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
const jobs = (wf) => [...wf.slice(wf.indexOf("\njobs:\n")).matchAll(/\n  ([a-z][\w-]*):\n/g)].map((m) => m[1]);

for (const [file, crons, lag, why] of FLOWS) {
  test(`${file}: runs after Fetch Grain Bids, gated to its own cron`, () => {
    const wf = read(".github/workflows/" + file);
    const on = wf.slice(wf.indexOf("\non:\n"), wf.indexOf("\njobs:\n"));
    assert.deepEqual([...on.matchAll(/- cron: ["']([^"']+)["']/g)].map((m) => m[1]), crons, "the schedule is unchanged");
    assert.match(on, /\n  workflow_run:\n    workflows: \["Fetch Grain Bids"\]\n    types: \[completed\]\n/);
    assert.match(on, /\n  workflow_dispatch:\n/, "a run by hand stays");

    const gate = job(wf, "gate");
    const m = /python3 scripts\/cron_gate\.py tick --workflow (\S+) --max-lag (\d+)((?:\n\s+--cron "[^"]+")+)/.exec(gate);
    assert.ok(m, "a cron_gate.py tick step");
    assert.equal(m[1], file, "the gate counts this workflow's own runs");
    assert.deepEqual([...m[3].matchAll(/--cron "([^"]+)"/g)].map((x) => x[1]), crons, "the gate carries the schedule's own crons");
    assert.equal(Number(m[2]), lag, "max-lag: " + why);
    assert.match(gate, /permissions:\n\s+actions: read\n\s+contents: read\n/, "the gate may list runs and nothing more");
    assert.match(gate, /outputs:\n\s+go: \$\{\{ steps\.g\.outputs\.go \}\}/);
    assert.match(gate, /sparse-checkout: \|\n\s+scripts\/cron_gate\.py\n\s+\/\.github\/actions\/engine\/\n\s+\/\.github\/engine-paths\n\s+sparse-checkout-cone-mode: false/,
      "the skip is cheap: only the gate script and the engine step are checked out");
    assert.match(gate, /persist-credentials: false/);
    assert.ok(gate.indexOf("name: Engine checkout") > gate.indexOf("actions/checkout@v4") && gate.indexOf("name: Engine checkout") < gate.indexOf("python3 scripts/cron_gate.py"),
      "the engine step right after the checkout, before the gate runs");
    assert.match(gate, /GH_TOKEN: \$\{\{ github\.token \}\}/);

    // every other job waits for the gate; the first ones run only on go
    for (const name of jobs(wf).filter((j) => j !== "gate")) {
      const j = job(wf, name);
      assert.match(j, /\n    needs: (gate|\[gate, [\w-]+\])\n/, name + " needs the gate");
      assert.match(j, /\n    if: [^\n]*needs\.gate\.outputs\.go == '1'/, name + " runs only when the gate says go");
    }
    // no workflow-wide queue: a chained run that skips must never wait in, or replace a run in, the job queue
    assert.doesNotMatch(on + wf.slice(wf.indexOf("\npermissions:"), wf.indexOf("\njobs:\n")), /^concurrency:/m,
      "the queue is on the working job, not the workflow");
  });
}

// GitHub expressions in these SEND lines use only ==, &&, || and parentheses on strings: JS gives the same answer.
const evalExpr = (expr, ctx) => {
  const js = expr
    .replace(/github\.event_name/g, JSON.stringify(ctx.event))
    .replace(/vars\.(\w+)/g, (_, k) => JSON.stringify((ctx.vars || {})[k] || ""))
    .replace(/inputs\.(\w+)/g, (_, k) => JSON.stringify((ctx.inputs || {})[k] ?? ""))
    .replace(/'([^']*)'/g, (_, s) => JSON.stringify(s));
  assert.doesNotMatch(js, /[a-z_]+\.[a-z_]/i, "every name replaced: " + js);
  return Function("return (" + js + ");")();
};
const envExpr = (wf, key) => {
  const m = new RegExp("\\n\\s+" + key + ": \\$\\{\\{ (.*) \\}\\}\\n").exec(wf);
  assert.ok(m, key);
  return m[1];
};

for (const [file, live] of [["rain-monthly.yml", "RAIN_MONTHLY_LIVE"], ["land-alert.yml", "LANDSALES_MONTHLY_LIVE"]]) {
  test(`${file}: a chained run sends exactly like the scheduled run; a run by hand keeps its own inputs`, () => {
    const wf = read(".github/workflows/" + file);
    const send = envExpr(wf, "SEND"), preview = envExpr(wf, "PREVIEW"), asked = envExpr(wf, "ASKED_SEND");
    const on = { [live]: "1" };
    for (const event of ["schedule", "workflow_run"]) {
      assert.equal(evalExpr(send, { event, vars: on }), "1", event + ": the list, once the variable is on");
      assert.equal(evalExpr(send, { event, vars: {} }), "", event + ": nothing without the variable");
      assert.equal(evalExpr(preview, { event, vars: on }), "", event + ": no preview");
      assert.equal(evalExpr(asked, { event, vars: on }), "", event + ": not a send asked by hand");
    }
    assert.equal(evalExpr(send, { event: "workflow_dispatch", vars: on, inputs: { mode: "dry" } }), "", "by hand: dry by default");
    assert.equal(evalExpr(send, { event: "workflow_dispatch", vars: on, inputs: { mode: "send" } }), "1", "by hand: send asked for");
    assert.equal(evalExpr(send, { event: "workflow_dispatch", vars: {}, inputs: { mode: "send" } }), "", "by hand: never without the variable");
    assert.equal(evalExpr(envExpr(wf, "MONTH"), { event: "workflow_run", inputs: {} }), "", "a chained run mails the month just ended");
    if (file === "rain-monthly.yml") {
      // the scheduled path fetches first; a chained run must too, and the email only after that fetch went through
      const iff = /\n    if: (.*)\n/.exec(job(wf, "fresh"))[1];
      const go = (event, fetch) => evalExpr(iff.replace("needs.gate.outputs.go", "'1'").replace("inputs.fetch == true", fetch ? "'x' == 'x'" : "'x' == 'y'"), { event });
      assert.equal(go("schedule", false), true, "scheduled: fetch first");
      assert.equal(go("workflow_run", false), true, "chained: fetch first, the same as scheduled");
      assert.equal(go("workflow_dispatch", false), false, "by hand: fetch only when ticked");
      assert.equal(go("workflow_dispatch", true), true, "by hand, fetch ticked");
    }
  });
}

test("arcplc-reminder.yml: a chained run passes --send exactly like the scheduled run; by hand stays dry by default", () => {
  const wf = read(".github/workflows/arcplc-reminder.yml");
  const send = job(wf, "remind");
  const m = /\n        run: \|\n((?:          [^\n]*\n)+)/.exec(send.slice(send.indexOf("- name: Send")));
  assert.ok(m, "the send step's script");
  const script = m[1].replace(/^ {10}/gm, "").replace("python3 scripts/send_notice.py", "echo ARGS:");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arcplc-gate-"));
  const f = path.join(tmp, "send.sh");
  fs.writeFileSync(f, script);
  const run = (env) => execFileSync("bash", [f], { encoding: "utf8", env: { PATH: process.env.PATH, EVENT: "", TOPIC: "", DRY: "", ...env } }).trim();
  assert.equal(run({ EVENT: "schedule" }), "ARGS: --send");
  assert.equal(run({ EVENT: "workflow_run" }), "ARGS: --send", "chained: the scheduled path");
  assert.equal(run({ EVENT: "workflow_dispatch", DRY: "true" }), "ARGS:", "by hand: dry by default");
  assert.equal(run({ EVENT: "workflow_dispatch", DRY: "false", TOPIC: "arcplc:2026-12-11" }), "ARGS: --send --topic arcplc:2026-12-11 --any-day");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("county-rain.yml: a chained run fetches every state for this year, like the scheduled run; the queue is shared with the rain email's fetch", () => {
  const wf = read(".github/workflows/county-rain.yml");
  const rain = job(wf, "rain");
  assert.match(rain, /STATES: \$\{\{ github\.event\.inputs\.states \}\}/, "states only from a run by hand (empty on a chained run: every state)");
  assert.doesNotMatch(rain, /event_name/, "no step takes a different path on a chained run than on a scheduled one");
  assert.match(rain, /concurrency:\n\s+group: county-rain\n\s+cancel-in-progress: false/);
  assert.match(job(read(".github/workflows/rain-monthly.yml"), "fresh"), /concurrency:\n\s+group: county-rain\n\s+cancel-in-progress: false/);
});

test("the gate passes over runs by hand for these four, and cron health watches their gate clocks", () => {
  const out = execFileSync("python3", ["scripts/cron_gate.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /all cron_gate checks passed/);
  for (const name of ["mail workflow: a run by hand after the tick does not serve it; the chained run sends",
    "other workflows: a run by hand still serves the tick (unchanged)",
    "mail workflow: the second chained run after the tick still skips",
    "the four mail and rain workflows and the 51 gated since Nov 3, and only those, ignore runs by hand"]) {
    assert.ok(out.includes("ok   " + name), "cron_gate selftest ran: " + name);
  }
  const ch = execFileSync("python3", ["scripts/cron_health.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(ch, /all cron_health checks passed/);
  const src = read("scripts/cron_health.py");
  for (const [file] of FLOWS) {
    assert.match(src, new RegExp('\\("' + file.replace(".", "\\.") + '", None, \\d+, False,'), file + ": the row reads the gate clock");
    assert.ok(ch.includes("ok   " + file + ": the gate clock is the workflow's own schedule"), file + ": cron health checked the gate clock");
  }
});
