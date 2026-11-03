// The Daily's USDA market lines (fx/dailyusda, Nov 3 2026): cash hogs and the pork
// cutout, daily slaughter, ethanol plant corn bids, Gulf export bids, and farm diesel
// and fertilizer the issue after a new report, handed to the writer with their
// sources and dates, withheld when missing, stale or not yet out at the send.
// scripts/test_daily_usda.py holds the cases; this runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("USDA market lines for the Daily's writer (scripts/test_daily_usda.py)", () => {
  const out = execFileSync("python3", ["scripts/test_daily_usda.py"], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  assert.match(out, /test_daily_usda: 0 failure\(s\)/, out.slice(-3000));
});
