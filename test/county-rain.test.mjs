/* Rain by county (/rain, /rain/<state>, /rain/<state>/<county>).
 *
 * The fetch and the pages are tested in Python on saved ACIS answers
 * (test/fixtures/rain): gaps, traces, S and A days, a county with no station,
 * a station that missed too many days, no normals, a leap year. This runs
 * those, then holds the shipped files to the builder: whatever is in
 * data/rain is exactly what the pages and sitemap-rain.xml say, and every
 * shipped county page stays small and keeps the answer in the HTML.
 *
 *   node --test test/county-rain.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (args) => execFileSync("python3", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("fetch arithmetic and station pick, on saved ACIS answers", () => {
  assert.match(py(["scripts/fetch_county_rain.py", "--selftest"]), /county rain fetch selftest: ok/);
});

test("pages built from the saved answers: answer first, honest gaps, small, structured data", () => {
  assert.match(py(["scripts/build_county_rain.py", "--selftest"]), /county rain pages selftest: ok/);
});

test("shipped data and pages match the builder, and the data passes its check", () => {
  assert.match(py(["scripts/fetch_county_rain.py", "--check"]), /0 problem\(s\)/);
  assert.match(py(["scripts/build_county_rain.py", "--check"]), /match data\/rain/);
});

test("sitemap-rain.xml is in robots.txt; the rain folder has a budget; the workflow exists", () => {
  assert.ok(readFileSync(ROOT + "robots.txt", "utf8").includes("Sitemap: https://agsist.com/sitemap-rain.xml"));
  assert.match(readFileSync(ROOT + "scripts/check_site_budget.py", "utf8"), /"rain":\s*\d+/);
  const wf = readFileSync(ROOT + ".github/workflows/county-rain.yml", "utf8");
  assert.match(wf, /fetch_county_rain\.py/);
  assert.match(wf, /build_county_rain\.py/);
  assert.match(wf, /workflow_dispatch/);
});

test("every shipped county page is small and has its answer in the HTML", () => {
  const dir = ROOT + "rain";
  if (!existsSync(dir)) return;
  const locs = new Set([...readFileSync(ROOT + "sitemap-rain.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  for (const st of readdirSync(dir)) {
    if (!statSync(dir + "/" + st).isDirectory()) continue;
    for (const f of readdirSync(dir + "/" + st)) {
      const rel = `rain/${st}/${f}`;
      const html = readFileSync(ROOT + rel, "utf8");
      if (html.includes('name="agsist-pointer"')) continue;   // a county that left the data (test/pointer-pages.test.mjs)
      assert.ok(html.length < 25 * 1024, rel + " is over 25 KB");
      assert.match(html, /<p class="rc-answer"><b>\d+\.\d\d inch(es)?<\/b> of rain/, rel + " has no answer up top");
      assert.ok(!html.includes("—") && !html.includes("&mdash;"), rel + " has an em dash");
      assert.ok(locs.has("https://agsist.com/" + rel.replace(/\.html$/, "")), rel + " is not in sitemap-rain.xml");
    }
  }
});
