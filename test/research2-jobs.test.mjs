/* Research round two API jobs (Oct 18, 2026): the elevator sites re-read
 * (build=elevsites2, merged into a to-do v2), discount and drying schedules
 * (scripts/schedules_job.py, build=schedules) and county land sale sources
 * (scripts/landsrc_job.py, build=landsrc). The Python selftests hold the
 * validators: a number not written in its quote is dropped, a quote not on the
 * saved page drops the schedule, a URL we never saw is dropped, a "yes" with
 * no evidence is "unclear". Here: caps, models, dispatch only, inputs from
 * the bids side branches, no em dashes in prompts.
 *
 *   node --test test/research2-jobs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("each job's checks pass their selftests", () => {
  assert.match(py(["scripts/schedules_job.py", "selftest"]), /schedules selftest ok/);
  assert.match(py(["scripts/landsrc_job.py", "selftest"]), /landsrc selftest ok/);
  assert.match(py(["scripts/elevsites_job.py", "selftest"]), /elevsites selftest ok/);
});

test("caps, models and the cap override that only lowers", () => {
  const src = readFileSync(ROOT + "scripts/api_jobs.py", "utf8");
  assert.match(src, /SCHEDULE_CAP = 20\.0/);
  assert.match(src, /LANDSRC_CAP = 20\.0/);
  assert.match(src, /return min\(cap, RUN_CAP\) if RUN_CAP is not None else cap/);
  assert.match(src, /STORY_MODEL if kind in \("story", "schedule"\) else MODEL/);
});

test("the workflow builds each input from its own bids side branch, dispatch only", () => {
  const wf = readFileSync(ROOT + ".github/workflows/api-jobs.yml", "utf8");
  assert.match(wf, /schedules\)\s*\n\s*git clone -q --depth 1 --branch schedules https:\/\/github\.com\/dnilgis\/bids\.git/);
  assert.match(wf, /landsrc\)\s*\n\s*git clone -q --depth 1 --branch countysites https:\/\/github\.com\/dnilgis\/bids\.git/);
  assert.match(wf, /ELEVSITES_MERGE_WITH=elevsites-2026-10/);
  assert.match(wf, /elevsites_job\.py merge/);
  assert.match(wf, /schedules_job\.py collect/);
  assert.match(wf, /landsrc_job\.py collect/);
  assert.doesNotMatch(wf, /^\s*schedule:/m, "dispatch only, no cron");
});

test("prompts carry no em dash and ask for no prices", () => {
  for (const f of ["scripts/schedules_job.py", "scripts/landsrc_job.py"]) {
    const s = readFileSync(ROOT + f, "utf8");
    assert.doesNotMatch(s, /—/, f);
  }
  assert.match(readFileSync(ROOT + "scripts/landsrc_job.py", "utf8"), /Do not write any price/);
  assert.match(readFileSync(ROOT + "scripts/schedules_job.py", "utf8"), /Copy, do not compute/);
});

test("the schedules bundle skips companies with no schedule page and redacts keys", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "schedb-"));
  try {
    const key = ["AI", "za", "Sy", "Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k"].join("");
    const caps = path.join(t, "caps", "2026-10-18-1"), sh = path.join(caps, "captures-0");
    for (const s of ["coop-com", "coop-com-discounts-pdf", "other-com"]) fs.mkdirSync(path.join(sh, s), { recursive: true });
    fs.writeFileSync(path.join(caps, "list.txt"), "https://coop.com/  # R:Test Coop\nhttps://other.com/  # U:OTHER\n");
    fs.writeFileSync(path.join(caps, "worklist.json"), JSON.stringify({ companies: [{ company: "R:Test Coop", read: true, locations: 2 },
      { company: "U:OTHER", read: false }] }));
    fs.writeFileSync(path.join(sh, "index.json"), JSON.stringify([{ slug: "coop-com", pageUrl: "https://coop.com/", parent: null },
      { slug: "coop-com-discounts-pdf", pageUrl: "https://coop.com/discounts.pdf", parent: "https://coop.com/", pdf: true },
      { slug: "other-com", pageUrl: "https://other.com/", parent: null }]));
    fs.writeFileSync(path.join(sh, "coop-com", "digest.json"), JSON.stringify({ title: "Coop", text: `Welcome ${key}`, links: [] }));
    fs.writeFileSync(path.join(sh, "coop-com-discounts-pdf", "digest.json"), JSON.stringify({ title: "(PDF)", pdf: true,
      text: "Corn shrink 1.4% per point, drying 4 cents per point" }));
    fs.writeFileSync(path.join(sh, "other-com", "digest.json"), JSON.stringify({ title: "Other", text: "Cash bids only", links: [] }));
    const out = path.join(t, "bundle.json");
    assert.match(py(["scripts/schedules_job.py", "bundle", t, out]), /redacted 1 secret-looking/);
    const b = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual(b.schedule.map((r) => r.company), ["R:Test Coop"]);
    assert.equal(b.schedule[0].pages.length, 2);
    assert.deepEqual(b.nothingToRead.map((r) => r.company), ["U:OTHER"]);
    assert.ok(!JSON.stringify(b).includes(key));
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});
