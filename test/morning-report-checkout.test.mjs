/* The morning report job checks out only part of the repo (Oct 20).
 *
 * Its gate runs morning_report.py --selftest, and the Today section's test
 * reads test/fixtures/today-bids-index-2026-10-20.json.gz. The checkout list
 * named only scripts/, data/*.json and TODO-SIG.md, so the dry run of Oct 20
 * failed with FileNotFoundError and the 6:40 email would have stopped. This
 * reads every repo file the selftests open from test/ and checks the report
 * job's checkout list covers it.
 *
 *   node --test test/morning-report-checkout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = readFileSync(new URL("../.github/workflows/morning-report.yml", import.meta.url), "utf8");
const job = wf.slice(wf.indexOf("\n  report:"));
const list = job.split("sparse-checkout: |")[1].split("sparse-checkout-cone-mode")[0]
  .split("\n").map(s => s.trim()).filter(Boolean);
const glob = p => new RegExp("^" + p.replace(/^\//, "").replace(/[.]/g, "\\.").replace(/\*/g, "[^/]*") + (p.endsWith("/") ? "" : "$"));
const covered = f => list.some(p => glob(p).test(f));

test("every test/ file the report selftests open is checked out", () => {
  const read = [];
  for (const s of ["scripts/morning_report.py", "scripts/form_digest.py"]) {
    const src = readFileSync(new URL("../" + s, import.meta.url), "utf8");
    for (const m of src.matchAll(/os\.path\.join\(ROOT,\s*((?:"[^"]+",?\s*)+)\)/g)) {
      const parts = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
      if (parts[0] === "test") read.push(parts.join("/"));
    }
  }
  assert.ok(read.includes("test/fixtures/today-bids-index-2026-10-20.json.gz"), "found the Today fixture read");
  for (const f of read) assert.ok(covered(f), f + " is not in the report job's sparse checkout");
});
