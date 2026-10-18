/* FAQ gaps on the tool pages (scripts/faq_gaps.py, job "faq" in scripts/api_jobs.py).
 *
 * The Python selftest checks: a proposal is kept only when its quote is in the
 * source the page was given and every number in the answer is in that quote;
 * a planted wrong number, an invented quote, a source the page was not given,
 * a repeat of the page's own FAQ, an em dash and an amount word not in the
 * quote are each refused. Competitor benchmark copies and failed fetches are
 * never offered as sources. Here: the wiring in the workflow and the prompt.
 *
 *   node --test test/faq-gaps.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("the validator keeps sourced answers and refuses guessed numbers", () => {
  assert.match(py(["scripts/faq_gaps.py", "selftest"]), /faq_gaps selftest ok \((\d+) tool pages\)/);
  assert.match(py(["scripts/api_jobs.py", "selftest"]), /selftest ok/);
});

test("the job is wired into the dispatch-only workflow with its own cap", () => {
  const wf = read(".github/workflows/api-jobs.yml");
  assert.match(wf, /faq-gaps\)/);
  assert.match(wf, /faq_gaps\.py bundle/);
  assert.match(wf, /faq_gaps\.py collect/);
  assert.doesNotMatch(wf, /^\s*schedule:/m, "no cron");
  const jobs = read("scripts/api_jobs.py");
  assert.match(jobs, /FAQ_CAP = 25\.0/);
  const fg = read("scripts/faq_gaps.py");
  assert.match(fg, /^CAP = 25\.0/m);
  assert.match(fg, /^MODEL = "claude-opus-5-5"/m);
});

test("the prompt asks for Sig's voice and carries no em dashes", () => {
  const fg = read("scripts/faq_gaps.py");
  const system = fg.slice(fg.indexOf('SYSTEM = """'), fg.indexOf('USER = """'));
  assert.ok(system.length > 500);
  assert.doesNotMatch(system, /[—–]/);
  assert.match(system, /ONLY from the source excerpts/);
  assert.match(system, /No em dashes/);
});
