/* released_at beside the fetch time (god's-eye build 7, Nov 9 2026): when each weekly report was public,
 * so a test can use only what was knowable on a date. One helper, scripts/released_at.py; the drought,
 * crop progress, export sales and AgTransport fetchers and the vintage writer call it.
 *
 *   node --test test/released-at.test.mjs
 *
 * Real files: the drought map valid Tue Nov 3 was out Thu Nov 5 8:30 am ET; Crop Progress for the week
 * ending Sun Oct 25 was out Mon Oct 26 4 pm ET; export sales for the week ending Thu Oct 29 were out
 * Thu Nov 5 8:30 am ET; AgTransport barge rates were changed Thu Nov 5 17:20 UTC (rowsUpdatedAt).
 * The data files are rewritten by their jobs, so this checks the rule on each file's own dates (never
 * after the file was fetched, never before the week it reports), not pinned values. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const json = (p) => JSON.parse(read(p));

function stamp(kind, day, fetched) {
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
from released_at import stamp
print(json.dumps(stamp(${JSON.stringify(kind)}, ${JSON.stringify(day)}, ${JSON.stringify(fetched)})))`;
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
}

test("released_at: the schedules, hand-worked", () => {
  execFileSync("python3", [join(ROOT, "scripts/released_at.py"), "--selftest"], { stdio: "pipe" });
  const late = "2026-12-31T00:00:00Z";
  assert.equal(stamp("usdm", "2026-11-03", late).released_at, "2026-11-05T13:30:00Z");
  assert.equal(stamp("crop_progress", "2026-10-25", late).released_at, "2026-10-26T20:00:00Z");
  assert.equal(stamp("export_sales", "2026-10-29", late).released_at, "2026-11-05T13:30:00Z");
});

test("released_at: on each real file's own dates, never after the fetch and never before the week", () => {
  const cases = [];
  for (const p of ["data/drought/county-week.json", "data/drought/summary.json"]) {
    const d = json(p);
    cases.push([p, "usdm", d.valid, d.fetched, d]);
  }
  const cp = json("data/crop-progress.json");
  if (cp.report_date) cases.push(["data/crop-progress.json", "crop_progress", cp.report_date, cp.fetched || cp.updated + "T23:59:59Z", cp]);
  const ex = json("data/export-sales.json");
  if (ex.report_date) cases.push(["data/export-sales.json", "export_sales", ex.report_date, ex.fetched || ex.updated + "T23:59:59Z", ex]);
  assert.ok(cases.length >= 3, `only ${cases.length} files read`);
  for (const [p, kind, day, fetched, doc] of cases) {
    const s = stamp(kind, day, fetched);
    assert.ok(s.released_at <= new Date(fetched).toISOString().replace(".000", ""), `${p}: released after we fetched it`);
    assert.ok(s.released_at.slice(0, 10) >= day, `${p}: released before the week it reports`);
    assert.ok(["schedule", "fetched"].includes(s.released_basis), p);
    // once the job has written it, the file's own released_at follows the same rule
    if (doc.released_at) {
      assert.equal(doc.released_at, s.released_at, `${p}: released_at is not what the schedule gives`);
      assert.ok(doc.released_basis && doc.released_rule, `${p}: says how it knows`);
    }
  }
  for (const p of ["data/transport/basis.json", "data/transport/journey.json"]) {
    const d = json(p);
    if (!d.released_at) continue;
    assert.ok(d.released_at <= d.generated, `${p}: released after we fetched it`);
    assert.ok(["source", "fetched"].includes(d.released_basis), p);
  }
});

test("released_at: every fetcher writes it beside its fetch time, from the one helper", () => {
  const writers = {
    "scripts/fetch_drought_county_week.py": /\*\*released\("usdm", latest, fetched\)/,
    "scripts/fetch_crop_progress.py": /stamp\("crop_progress", /,
    "scripts/fetch_export_sales.py": /stamp\('export_sales', /,
    "scripts/fetch_transport.py": /\*\*rel_basis/,
    "scripts/vintage.py": /socrata\(\[rec\.get\("meta"\)\]/,
  };
  for (const [p, re] of Object.entries(writers)) {
    assert.ok(existsSync(join(ROOT, p)), p);
    assert.match(read(p), re, `${p} writes released_at`);
    assert.match(read(p), /from released_at import/, `${p} uses scripts/released_at.py`);
  }
  for (const p of Object.keys(writers))
    assert.doesNotMatch(read(p), /time\((8, 30|16, 0)\)|def scheduled\(/, `${p} carries its own release schedule`);
});
