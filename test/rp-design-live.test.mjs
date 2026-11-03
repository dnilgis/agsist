// Nov 3, 2026: rp-design-email's DRY_RUN was `(A) && '' || (B) && '' || '1'`, which is '1' every
// time because '' is falsy in a GitHub expression, so no reader was ever mailed while
// RP_DESIGN_EMAIL_LIVE was 1. This evaluates the workflow's own expression for each case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const wf = readFileSync(join(ROOT, ".github", "workflows", "rp-design-email.yml"), "utf8");
const m = wf.match(/\n\s+DRY_RUN: \$\{\{(.*)\}\}\s*\n/);
const EXPR = m && m[1];

// GitHub expressions use the same truthiness and && / || / ! as JS for these operand kinds.
function evalExpr(event, live, dryInput) {
  const js = EXPR.replace(/github\.event_name/g, "E").replace(/vars\.RP_DESIGN_EMAIL_LIVE/g, "L")
    .replace(/inputs\.dry_run/g, "D").replace(/ == /g, " === ").replace(/ != /g, " !== ");
  assert.ok(/^[\sELD!()&|=']*(schedule|workflow_dispatch|workflow_run|1|[\sELD!()&|=']|false|true)*$/.test(js), js);
  return Function("E", "L", "D", "return (" + js + ");")(event, live, dryInput);
}

test("the DRY_RUN expression is found", () => assert.ok(EXPR, "no DRY_RUN line"));

test("live only when asked: hourly with the variable at 1, or a dispatch with dry_run false", () => {
  const sched = wf.includes("workflow_run") ? ["schedule", "workflow_run"] : ["schedule"];
  for (const ev of sched) {
    assert.equal(evalExpr(ev, "1", null), "", `${ev}, variable 1: live`);
    assert.equal(evalExpr(ev, "", null), "1", `${ev}, variable unset: dry`);
    assert.equal(evalExpr(ev, "0", null), "1", `${ev}, variable 0: dry`);
  }
  assert.equal(evalExpr("workflow_dispatch", "1", false), "", "dispatch dry_run false: live");
  assert.equal(evalExpr("workflow_dispatch", "1", true), "1", "dispatch dry_run true: dry");
  assert.equal(evalExpr("workflow_dispatch", "", true), "1");
  assert.equal(evalExpr("push", "1", null), "1", "any other event: dry");
});

test("the script reads DRY_RUN == '1' as dry and anything else as live", () => {
  const py = readFileSync(join(ROOT, "scripts", "rp_design_email.py"), "utf8");
  assert.match(py, /dry = env\("DRY_RUN"\) == "1"/);
  assert.match(py, /NOW_MAX_H = 24/);
});

test("rp-buyer-email: dry unless the worker asks with dry_run false", () => {
  const b = readFileSync(join(ROOT, ".github", "workflows", "rp-buyer-email.yml"), "utf8");
  const e = b.match(/\n\s+DRY_RUN: \$\{\{(.*)\}\}\s*\n/)[1];
  const f = (D) => Function("D", "return (" + e.replace(/inputs\.dry_run/g, "D").replace(/ == /g, " === ").replace(/ != /g, " !== ") + ");")(D);
  assert.equal(f(false), "", "dry_run false: live");
  assert.equal(f(true), "1");
  assert.equal(f(null), "1", "no input: dry");
});

// `X && '' || Y` is always Y in a GitHub expression ('' is falsy). It hid two senders for two weeks.
test("no workflow uses && '' (an empty string is falsy, so the branch can never win)", () => {
  const dir = join(ROOT, ".github", "workflows");
  const bad = [];
  for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)))
    readFileSync(join(dir, f), "utf8").split("\n").forEach((l, i) => {
      if (!/^\s*#/.test(l) && /&&\s*''/.test(l)) bad.push(`${f}:${i + 1}`);
    });
  assert.deepEqual(bad, []);
});
