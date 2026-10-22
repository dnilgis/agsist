/* Rain Print orders through a worker outage and a burst of orders (subs
 * worker v5.47, BUILD-RULES 14): a late or repeated Stripe webhook makes one
 * record with the design from Stripe's own reference, the poll finds payments
 * Stripe stopped retrying, serials stay unique under 40 orders at once (with
 * and without KV's one-write-a-second limit), RPH- refs, and a kept logo goes
 * up under its own id. The checks are in scripts/test_rp_burst_worker.mjs.
 *   node --test test/rp-burst.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
test("the worker under a burst and after an outage (scripts/test_rp_burst_worker.mjs)", () => {
  const out = execFileSync(process.execPath, [ROOT + "scripts/test_rp_burst_worker.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(out, /rp burst worker checks: \d+ passed/);
  assert.match(out, /40 at once, KV write limit/);
  assert.match(out, /40 at once, every write lands/);
});
