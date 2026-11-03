/* A green run is not a delivered email (BUILD-RULES 55 and 56, Nov 3 2026). rp-design-email and
 * rp-buyer-email ran green and dry for two weeks with the live variable at 1, and the subs worker had
 * never started either job. scripts/delivery_check.py reads the DELIVERY line every reader email
 * sender prints (scripts/delivery_line.py) and cron_health.py turns its findings into rows.
 *
 * This file holds:
 *   - the classifier, on fixtures only (delivery_check.py --selftest: no network, no date from today);
 *   - the inventory: every workflow with mail secrets is a reader sender or listed as Sig only; every
 *     sender script it lists is run by that workflow and prints the line under its name; every script
 *     run in a reader workflow's mail step is a listed sender or listed as Sig only; every script that
 *     prints the line is listed; cron-health passes every live switch. So a new sender cannot be missed.
 *
 *   node --test test/delivery-check.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const WF = path.join(ROOT, ".github/workflows");
const SCRIPTS = path.join(ROOT, "scripts");
const readWf = (f) => fs.readFileSync(path.join(WF, f), "utf8");
const py = (...a) => execFileSync("python3", a, { cwd: ROOT, encoding: "utf8", env: { ...process.env, DELIVERY_LINE_OFF: "1" } });
const INV = JSON.parse(py("scripts/delivery_check.py", "--inventory"));
const MAIL = /SMTP_PASS|GMAIL_APP_PASS|smtplib/;
const workflows = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f));

// The steps of a workflow, as text: split at each list item that starts a step.
function steps(text) {
  return text.split(/\n(?= {6}- (?:name|uses|run|id|if|env|with|shell|working-directory|timeout-minutes|continue-on-error):)/);
}
// scripts/<name>.py that a step runs for real (a --selftest line is a test, not a send)
function scriptsRun(stepText) {
  const out = new Set();
  for (const line of stepText.split("\n")) {
    if (/^\s*#/.test(line) || /--selftest/.test(line)) continue;
    for (const m of line.matchAll(/scripts\/([a-z0-9_]+\.py)\b/g)) out.add(m[1]);
  }
  return out;
}

test("the classifier passes its fixtures (no network, no clock)", () => {
  const out = py("scripts/delivery_check.py", "--selftest");
  assert.match(out, /delivery_check selftest: 0 failed/);
  assert.doesNotMatch(out, /^FAIL /m);
  assert.match(py("scripts/delivery_line.py", "--selftest"), /delivery_line selftest: 0 failed/);
});

test("every workflow with mail secrets is a listed reader sender or listed as Sig only", () => {
  const senders = new Set(INV.senders.map((e) => e.workflow));
  const sig = new Set(Object.keys(INV.sig_only));
  for (const w of [...senders, ...sig]) assert.ok(workflows.includes(w), `${w} is listed but has no workflow file`);
  const missing = workflows.filter((w) => MAIL.test(readWf(w)) && !senders.has(w) && !sig.has(w));
  assert.deepEqual(missing, [], "these workflows can send mail but are in neither scripts/delivery_check.py SENDERS nor "
    + "SIG_ONLY: add each sender with its live switch, and make its script print the DELIVERY line");
  for (const w of sig) assert.ok(MAIL.test(readWf(w)), `${w} is listed as Sig only but has no mail secret: drop it from SIG_ONLY`);
});

test("the brief's senders are all in the list", () => {
  const senders = new Set(INV.senders.map((e) => e.workflow));
  for (const w of ["daily.yml", "land-alert.yml", "rain-monthly.yml", "dairy.yml", "funds-weekly.yml", "rp-design-email.yml",
    "rp-buyer-email.yml", "elevator-watch.yml", "price-watch.yml", "arcplc-reminder.yml", "cash-rent.yml", "alert-check.yml",
    "form-digest.yml"]) assert.ok(senders.has(w), `${w} must be checked for delivery`);
});

test("each listed sender script is run by its workflow and prints the DELIVERY line under its name", () => {
  for (const e of INV.senders) {
    const text = readWf(e.workflow);
    const run = new Set(steps(text).flatMap((s) => [...scriptsRun(s)]));
    for (const [script, name] of Object.entries(e.senders)) {
      assert.ok(run.has(script), `${e.workflow} does not run scripts/${script} (outside a --selftest line)`);
      const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
      assert.ok(src.includes(`delivery_line.start("${name}"`) || src.includes(`delivery_line.Tally("${name}")`),
        `scripts/${script} does not start the DELIVERY line as "${name}"`);
      assert.ok(src.includes(`delivery_line.start("${name}"`), `scripts/${script} never arms the line for "${name}" (delivery_line.start)`);
    }
  }
});

test("every script a reader workflow runs in a mail step is a listed sender or listed as Sig only", () => {
  for (const e of INV.senders) {
    const known = new Set([...Object.keys(e.senders), ...(e.sig_scripts || [])]);
    for (const s of e.sig_scripts || []) assert.ok(readWf(e.workflow).includes(`scripts/${s}`), `${e.workflow}: sig_scripts names ${s}, which it no longer runs`);
    for (const s of steps(readWf(e.workflow))) {
      if (!/SMTP_PASS|GMAIL_APP_PASS/.test(s)) continue;
      for (const script of scriptsRun(s)) {
        const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
        if (!/smtplib|smtp_connect|send_message/.test(src)) continue;   // the step's other scripts do not mail
        assert.ok(known.has(script), `${e.workflow} runs scripts/${script} in a mail step: list it as a sender (with the `
          + `DELIVERY line) or in that entry's sig_scripts`);
      }
    }
  }
});

test("every script that arms the DELIVERY line is in the list, and each name is one sender", () => {
  const listed = new Map();
  for (const e of INV.senders) for (const [script, name] of Object.entries(e.senders)) {
    assert.ok(!listed.has(script) || listed.get(script) === name, `scripts/${script} has two names`);
    listed.set(script, name);
  }
  const owner = new Map();
  for (const [script, name] of listed) {
    assert.ok(!owner.has(name) || owner.get(name) === script, `the name ${name} is used by two scripts`);
    owner.set(name, script);
  }
  for (const f of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".py") && f !== "delivery_line.py")) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8");
    if (src.includes("delivery_line.start(")) assert.ok(listed.has(f), `scripts/${f} prints a DELIVERY line but no SENDERS entry reads it`);
  }
});

test("a sender's own selftest prints no DELIVERY line (a made-up count would land in its log)", () => {
  const env = { ...process.env };
  delete env.DELIVERY_LINE_OFF;
  for (const script of new Set(INV.senders.flatMap((e) => Object.keys(e.senders)))) {
    const src = fs.readFileSync(path.join(SCRIPTS, script), "utf8");
    if (!src.includes("--selftest")) continue;
    let out;
    try {
      out = execFileSync("python3", [`scripts/${script}`, "--selftest"], { cwd: ROOT, encoding: "utf8", env, timeout: 300000, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      out = String(err.stdout || "") + String(err.stderr || "");
    }
    assert.doesNotMatch(out, /DELIVERY sender=/, `scripts/${script} --selftest printed a DELIVERY line`);
  }
});

test("cron-health passes every live switch to the check, and can read the logs", () => {
  const ch = readWf("cron-health.yml");
  for (const v of INV.switch_vars) assert.match(ch, new RegExp(`\\n\\s+${v}: \\$\\{\\{ vars\\.${v} \\}\\}`), `cron-health.yml must pass vars.${v}`);
  assert.match(ch, /actions: read/);
  assert.match(ch, /python3 scripts\/delivery_check\.py --selftest/);
});

test("a worker-started job reads its asks or orders from a sender that prints them", () => {
  for (const e of INV.senders.filter((x) => x.worker_started)) {
    const [src, key] = e.evidence;
    const from = INV.senders.find((x) => x.workflow === src);
    assert.ok(from, `${e.workflow}: its evidence workflow ${src} is not a listed sender`);
    const script = Object.keys(from.senders)[0];
    assert.match(fs.readFileSync(path.join(SCRIPTS, script), "utf8"), new RegExp(`extra\\["${key}"\\]`),
      `scripts/${script} must count ${key}= on its DELIVERY line`);
  }
});
