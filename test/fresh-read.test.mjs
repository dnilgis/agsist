/* First-time visitor read of the hand-made pages (scripts/fresh_read.py, an
 * api_jobs.py job kind). The selftests check the request (Opus 5.5, adaptive
 * thinking, the shared menu cached once, long pages clipped), the $20 cap at the
 * worst case, and that the report flags quotes not on the page, fixes that add
 * numbers the page does not show, and em dashes.
 *
 *   node --test test/fresh-read.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("fresh read: requests, cap and report checks", () => {
  assert.match(py(["scripts/fresh_read.py", "selftest"]), /fresh_read selftest ok/);
  assert.match(py(["scripts/api_jobs.py", "selftest"]), /selftest ok/);
  const src = readFileSync(ROOT + "scripts/fresh_read.py", "utf8");
  assert.match(src, /MODEL = "claude-opus-5-5"/);
  assert.match(src, /CAP = 20\.0/);
  assert.ok(!src.includes("—"), "no em dashes in the prompt");
});
