/* The yield nowcast follows the week's ratings, not a calendar guess.
 *
 * 2026-10-16 audit: /conditions-yield showed the week ending Oct 4 for days
 * after the Columbus Day Crop Progress (released Tuesday Oct 13). The Tuesday
 * fire ran before the report, GitHub dropped both Wednesday catch-up fires
 * (conditions.yml and cond-yield.yml), and a manual run of both at once let
 * cond-yield read last week's ratings file. Each job now runs when its input
 * is on a newer week than its output: right after the job upstream of it,
 * and every two hours for five days off the 15-minute bids runs.
 *
 *   node --test test/cond-yield-chain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");

for (const [wf, mode, upstream, job] of [
  ["cond-yield.yml", "condyield", "conditions", "build"],
  ["conditions.yml", "conditions", "Fetch Crop Progress", "fetch"],
]) {
  test(`${wf}: chained after ${upstream} and the bids clock, gated on the data week`, () => {
    const y = read(".github/workflows/" + wf);
    const m = y.match(/workflow_run:\s*\n\s*workflows: \[([^\]]*)\]/);
    assert.ok(m, "has a workflow_run trigger");
    assert.ok(m[1].includes(`"${upstream}"`), `runs after ${upstream}`);
    assert.ok(m[1].includes('"Fetch Grain Bids"'), "retries off Fetch Grain Bids");
    assert.ok(y.includes(`python3 scripts/cron_gate.py ${mode}`), "gate step");
    assert.ok(y.includes("TRIGGER_WORKFLOW: ${{ github.event.workflow_run.name }}"), "gate knows who started it");
    assert.match(y, new RegExp(`\\n  ${job}:\\n    needs: gate\\n    if: needs.gate.outputs.go == '1'`), "work waits for the gate");
  });
}

test("upstream workflow names in the triggers are the real ones", () => {
  assert.match(read(".github/workflows/conditions.yml"), /^name: conditions$/m);
  assert.match(read(".github/workflows/crop_progress.yml"), /^name: Fetch Crop Progress$/m);
  assert.match(read(".github/workflows/fetch_bids.yml"), /^name: Fetch Grain Bids$/m);
});

test("cron_gate selftest passes (behind: Columbus Day week cases)", () => {
  const out = execFileSync("python3", [ROOT + "scripts/cron_gate.py", "--selftest"], { encoding: "utf8" });
  assert.match(out, /behind: upstream just wrote the new week, go at once/);
  assert.match(out, /all cron_gate checks passed/);
});
