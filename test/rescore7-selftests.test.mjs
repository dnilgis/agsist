/* Python selftests for the Oct 17, 2026 re-score fixes, run with the node suite:
 *   - scripts/fetch_land_sales.py: Illinois multi-parcel acres (each added PIN once,
 *     in acres, or blank) and the filed-date coverage;
 *   - scripts/watch_dates.py: every weekday in the Daily's watch list carries its date;
 *   - scripts/test_daily_trust.py: next week's export sales named, dated, on a Friday.
 *
 *   node --test test/rescore7-selftests.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const run = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8" });

test("land sales selftest: Illinois acres and coverage", () => {
  const out = run(["scripts/fetch_land_sales.py", "--selftest"]);
  assert.match(out, /FAILS=0/);
  assert.match(out, /ok +IL: an added PIN that comes back five times is not summed five times/);
});

test("watch list dates: 'Thursday 7:30 a.m. CT' in the Oct 16 issue is Thursday, Oct 22", () => {
  assert.match(run(["scripts/watch_dates.py", "--selftest"]), /FAILS=0/);
});

test("daily trust checks pass", () => {
  assert.match(run(["scripts/test_daily_trust.py"]), /0 failure\(s\)/);
});
