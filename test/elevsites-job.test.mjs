/* The unread elevators' sites API job (scripts/elevsites_job.py through
 * scripts/api_jobs.py, build=elevsites in api-jobs.yml).
 *
 * The Python selftest checks that an answer is kept only where the saved pages
 * back it: an invented bid page URL is dropped, a quote not in the saved text
 * turns "yes" into "unclear", town names not in the text are dropped, and the
 * to-do puts platforms bids already reads first. Here we also hold the
 * workflow to dispatch only, the $35 cap and the bids side branch as input.
 *
 *   node --test test/elevsites-job.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("answers are checked against the saved pages before they reach the to-do", () => {
  assert.match(py(["scripts/elevsites_job.py", "selftest"]), /elevsites selftest ok/);
  assert.match(py(["scripts/api_jobs.py", "selftest"]), /selftest ok/);
});

test("the job has its own cap, a model, and reads the bids captures in Actions only", () => {
  const src = readFileSync(ROOT + "scripts/api_jobs.py", "utf8");
  assert.match(src, /ELEVSITE_CAP = 35\.0/);
  const wf = readFileSync(ROOT + ".github/workflows/api-jobs.yml", "utf8");
  assert.match(wf, /elevsites\)\s*\n\s*git clone -q --depth 1 --branch elevsites https:\/\/github\.com\/dnilgis\/bids\.git/);
  assert.match(wf, /elevsites_job\.py collect/);
  assert.doesNotMatch(wf, /^\s*schedule:/m, "dispatch only, no cron");
  const job = readFileSync(ROOT + "scripts/elevsites_job.py", "utf8");
  assert.doesNotMatch(job, /—/, "no em dashes in the prompt");
});

test("the bundle built from the captures carries no secret-looking string (push protection)", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "elevb-"));
  try {
    const key = ["AI", "za", "Sy", "Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k"].join("");
    const mb = ["pk", ".eyJ", "1IjoiY29vcCIsImEiOiJjbGZ4In0", ".", "aBcD3fGh1jKlMn0pQrStUv"].join("");
    const caps = path.join(t, "caps", "2026-10-18-1"), sh = path.join(caps, "captures-0"), pg = path.join(sh, "coop-com");
    fs.mkdirSync(pg, { recursive: true });
    fs.writeFileSync(path.join(caps, "list.txt"), "https://coop.com/  # TEST COOP\n");
    fs.writeFileSync(path.join(caps, "worklist.json"), JSON.stringify({ companies: [{ company: "TEST COOP", realRows: 1, states: { IA: 1 } }] }));
    fs.writeFileSync(path.join(sh, "index.json"), JSON.stringify([{ slug: "coop-com", pageUrl: "https://coop.com/", parent: null }]));
    fs.writeFileSync(path.join(pg, "digest.json"), JSON.stringify({ title: "Coop", text: `Cash Bids Corn 3.85 ${mb}`,
      scripts: [`https://maps.googleapis.com/maps/api/js?key=${key}`], links: [] }));
    const out = path.join(t, "bundle.json");
    assert.match(py(["scripts/elevsites_job.py", "bundle", t, out]), /redacted 2 secret-looking/);
    const b = fs.readFileSync(out, "utf8");
    assert.ok(!b.includes(key) && !b.includes(mb) && b.includes("Corn 3.85"), b);
    assert.equal(JSON.parse(b).elevsite[0].company, "TEST COOP");
  } finally { fs.rmSync(t, { recursive: true, force: true }); }
});
