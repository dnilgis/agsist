// The Daily's "what a farmer should know today" blocks (fx/dailymore, Nov 2 2026):
// the farm calendar, last week's harvest pace and fund positions handed to the
// writer with their sources and dates, withheld when stale or not yet public,
// and the basis line moved up into the email's Today list.
// scripts/test_daily_more.py holds the cases; this runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("farm calendar, harvest pace, fund positions and the Today basis line (scripts/test_daily_more.py)", () => {
  const out = execFileSync("python3", ["scripts/test_daily_more.py"], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  assert.match(out, /test_daily_more: 0 failure\(s\)/, out.slice(-3000));
});
