/* Daily phase 2 (panel Nov 9 2026): one memory keyed by fact, the
 * state week-over-week basis line in place of the North Dakota line, funds on
 * Saturday as the streak, the overnight, ratio, percentile and cash-count rules,
 * month to date and the WASDE watch rule, raw counts off the web block, and the
 * subject ranking. Each case is a real day; scripts/test_daily_memory.py holds them. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("the Daily prints a recurring line only when its fact changed, on the real days it repeated", () => {
  const out = execFileSync("python3", ["scripts/test_daily_memory.py"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /test_daily_memory: 0 failure\(s\)/, out);
});
