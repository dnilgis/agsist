/* The monthly restore test: scripts/restore_test.py rebuilds a past day's corn and soybean town cards
 * from the daily bid snapshot and compares them with the town pages baked at the nearest rebuild
 * commit; at least 99% of the comparable rows must match. A failed run turns its cron health row red.
 *   node --test test/restore-test.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/restore-test.yml"), "utf8");

test("restore_test selftest: rounding, delivery months, matching, left-out cards, threshold, seeded pick", () => {
  const r = spawnSync("python3", ["scripts/restore_test.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of ["cash to the cent, half up like the pages", "a cent off or another month is a miss",
    "another state's row never counts", "99 of 100 passes", "98 of 100 fails", "no row read at all fails and says why",
    "only live captures are tested", "the pick is seeded by the month: a rerun repeats it, the next month differs"]) {
    assert.ok(r.stdout.includes("ok   " + name), name);
  }
});

test("restore-test.yml: full history without file bodies, the snapshots from the private repo, the default 99% bar", () => {
  assert.match(wf, /fetch-depth: 0\n\s+filter: blob:none/);
  assert.match(wf, /bash scripts\/fetch_private\.sh raw/);
  assert.match(wf, /python3 scripts\/restore_test\.py "\$@"/);
  assert.doesNotMatch(wf, /--min/, "the bar stays at the script's 99%");
  assert.doesNotMatch(wf, /issues: write|gh issue/, "the alert is the cron health row, not an issue");
});
