/* A Daily headline that fails its check is rewritten before the send and checked
 * again until it passes (Sig, Oct 27 2026). Regression case: the Oct 21 headline
 * "Corn down 6 straight days to $4.59½; beans down 7 to $12.45" (a run of settles
 * counted to a 5:46 a.m. trade). The model is stubbed or absent; no API call.
 *   node --test test/headline-fix.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const env = { ...process.env, ANTHROPIC_API_KEY: "", SMTP_USER: "", SMTP_PASS: "", GMAIL_USER: "", GMAIL_APP_PASS: "" };
const run = (args) => spawnSync("python3", args, { cwd: ROOT, encoding: "utf8", env });

test("selftest: retry still bad then good, all bad to the code fallback, held", () => {
  const r = run(["scripts/headline_fix.py", "--selftest"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /headline_fix selftest: ok/);
});

test("the Oct 21 issue as it went out: no model, so the code fallback goes in and passes", () => {
  const b = JSON.parse(read("data/daily-archive/2026-10-21.json"));
  b.headline = "Corn down 6 straight days to $4.59½; beans down 7 to $12.45";
  b.teaser = b.headline;
  const dir = mkdtempSync(join(tmpdir(), "hlfix-"));
  const f = join(dir, "daily.json");
  writeFileSync(f, JSON.stringify(b));
  const r = run(["scripts/headline_fix.py", f, "--prices", join(dir, "none.json")]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /try 1\/3: the model call failed/);
  assert.match(r.stdout, /code fallback passes/);
  const out = JSON.parse(readFileSync(f, "utf8"));
  assert.equal(out.headline, "Corn settled at $4.62 on Oct 20; beans at $12.48¼");
  assert.equal(out.teaser, out.headline, "the teaser copied the old headline and takes the new one");
  assert.equal(out.headline_fix.result, "fallback");
  assert.equal(out.headline_fix.tries.length, 3);
  const g = run(["scripts/briefing_gate.py", f, "--prices", join(dir, "none.json")]);
  assert.doesNotMatch(g.stdout, /\[FAIL \] claim:[^\n]*headline:/, g.stdout);
});

test("no settle to fall back on: the send is held (exit 1) and Sig is alerted", () => {
  const b = JSON.parse(read("data/daily-archive/2026-10-21.json"));
  b.headline = "Corn down 6 straight days to $4.59½; beans down 7 to $12.45";
  b.quote_strip.vs_session = null;
  const dir = mkdtempSync(join(tmpdir(), "hlfix-"));
  const f = join(dir, "daily.json");
  writeFileSync(f, JSON.stringify(b));
  const r = run(["scripts/headline_fix.py", f, "--prices", join(dir, "none.json")]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Daily held, headline/);
  assert.match(r.stdout, /alert to Sig: NOT sent/);
  assert.equal(JSON.parse(readFileSync(f, "utf8")).headline, b.headline, "a held issue is left as it was");
});

test("the gate fails a headline claim now, it no longer only warns", () => {
  const gate = read("scripts/briefing_gate.py");
  assert.ok(gate.includes("daily_claims.CUTTABLE(_loc) or _loc == 'headline'"), gate.slice(-2000));
});

test("daily.yml runs the fix after the critic and fact check, right before GATE 2, as a hard step", () => {
  const y = read(".github/workflows/daily.yml");
  const fix = y.indexOf("python scripts/headline_fix.py data/daily.json");
  const gate = y.indexOf("python scripts/briefing_gate.py data/daily.json");
  assert.ok(fix > 0 && gate > fix, "fix step missing or after GATE 2");
  assert.ok(fix > y.indexOf("python scripts/critique_briefing.py") && fix > y.indexOf("python scripts/fact_check_briefing.py"));
  const step = y.slice(y.lastIndexOf("- name:", fix), fix);
  assert.doesNotMatch(step, /continue-on-error/);
  assert.match(step, /ANTHROPIC_API_KEY= python scripts\/headline_fix.py --selftest/);
  assert.match(step, /OWNER_TO:\s+\$\{\{ secrets.SIG_TO \}\}/);
});
