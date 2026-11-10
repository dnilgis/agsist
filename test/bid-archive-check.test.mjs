/* The monthly bid archive check: scripts/bid_archive_check.py compares one past day's raw daily bid
 * snapshot with that state's corn and soybean town pages as committed at the nearest page rebuild
 * (nothing is rebuilt); at least 99% of the comparable rows must match. Backfilled, partial and thin
 * days are skipped. A failed run turns its cron health row red.
 *   node --test test/bid-archive-check.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/bid-archive-check.yml"), "utf8");

test("bid_archive_check selftest: rounding, delivery months, matching, left-out cards, threshold, one-cent shift, thin days, seeded pick", () => {
  const r = spawnSync("python3", ["scripts/bid_archive_check.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const name of ["cash to the cent, half up like the pages", "a cent off or another month is a miss",
    "another state's row never counts", "99 of 100 passes", "98 of 100 fails", "no row read at all fails and says why",
    "only live captures are tested", "the pick is seeded by the month: a rerun repeats it, the next month differs",
    "a real-shaped state: every one of its 80 rows matches its own snapshot",
    "every cash value one cent off drops the match under the 99% bar and fails",
    "a thin day is skipped, printed and written to the step summary with its count and the median",
    "half the median or more is checked (1,100 of 2,014.5); backfilled and partial days stay out of the median",
    "under half the median is thin; exactly half is not; no median, no rule"]) {
    assert.ok(r.stdout.includes("ok   " + name), name);
  }
});

test("bid-archive-check.yml: full history without file bodies, the snapshots from the private repo, the default 99% bar", () => {
  assert.match(wf, /fetch-depth: 0\n\s+filter: blob:none/);
  assert.match(wf, /bash scripts\/fetch_private\.sh raw/);
  assert.match(wf, /python3 scripts\/bid_archive_check\.py "\$@"/);
  assert.doesNotMatch(wf, /--min/, "the bar stays at the script's 99%");
  assert.doesNotMatch(wf, /issues: write|gh issue/, "the alert is the cron health row, not an issue");
});

test("bid-archive-check.yml says what it is: an archive check, not a rebuild or restore", () => {
  assert.match(wf, /^name: Bid archive check \(monthly\)$/m);
  assert.doesNotMatch(wf, /[Rr]estore|[Rr]ebuild a past/);
  const src = fs.readFileSync(path.join(ROOT, "scripts/bid_archive_check.py"), "utf8");
  assert.doesNotMatch(src, /[Rr]estore test/);
  assert.doesNotMatch(src, /2026-10-30/, "the thin rule names no date");
});
