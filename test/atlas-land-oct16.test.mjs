/* Farmland Atlas, Oct 16, 2026 head-to-head fixes:
 *   - the county card puts the state's farm real estate value (land and buildings, the census
 *     definition) beside the county's 2022 census value, never cropland alone.
 *     Barron County, WI: census $4,336 (2022); WI farm real estate 2026 $6,700, cropland $7,600
 *     (NASS Land Values 2026, saved as bench-farmland-atlas-2)
 *   - a dated link to the state's own survey where one was read from a saved copy (IA, NE, ND)
 *   - the rented layer (#l=ten_rent) prints the national share beside the legend:
 *     2022: 345,889,019 / (534,211,829 + 345,889,019) = 39.30%; 1997: 384,832,113 / 954,752,502 = 40.31%
 *   - tenure.json is requested once, even with the tenure fold open
 *
 *   node --test test/atlas-land-oct16.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (f) => readFileSync(ROOT + f, "utf8");

test("county card: state farm real estate beside the census value, not cropland", () => {
  const b = read("farmland-atlas/wisconsin/barron-county.html");
  assert.match(b, /WI farm real estate 2026: \$6,700 \(land and buildings, state survey\)/);
  assert.doesNotMatch(b, /WI cropland 2026: \$7,600/);
  const sv = JSON.parse(read("data/atlas/state-value.json")).states.WI;
  assert.equal(sv.real_estate["2026"], 6700);
  // cropland stays in the land value section, labeled as the state's
  assert.match(b, /Wisconsin cropland, 2026 state survey/);
  const s = read("farmland-atlas/iowa/story-county.html");
  assert.match(s, /IA farm real estate 2026: \$10,100 \(land and buildings, state survey\)/);
});

test("the state's own survey: dated, linked, read from a saved copy", () => {
  const U = JSON.parse(read("data/atlas/state-land-surveys.json")).states;
  const ids = JSON.parse(read("references/sources.json")).sources.map((r) => r.id);
  for (const [st, u] of Object.entries(U)) {
    for (const k of ["name", "org", "date", "url", "ref", "checked"]) assert.ok(u[k], `${st}.${k}`);
    assert.ok(ids.includes(u.ref), `${st}: ${u.ref} is not in references/sources.json`);
  }
  assert.equal(U.IA.date, "Dec 9, 2025");
  assert.equal(U.NE.date, "Jun 30, 2026");
  const s = read("farmland-atlas/iowa/story-county.html");
  assert.match(s, /Newer local survey: <a href="https:\/\/farmland\.card\.iastate\.edu\/isu-land-value-survey-2025" rel="noopener">ISU Land Value Survey 2025<\/a>, Iowa State University, released Dec 9, 2025/);
  assert.doesNotMatch(read("farmland-atlas/wisconsin/barron-county.html"), /Newer local survey/, "no survey on file, no line");
});

test("national rented share: the numbers the legend line prints", () => {
  const T = JSON.parse(read("data/tenure/tenure.json")).national;
  const sh = (p) => p[1] / (p[0] + p[1]);
  assert.equal((100 * sh(T["2022"])).toFixed(1), "39.3");
  assert.equal((100 * sh(T["1997"])).toFixed(1), "40.3");
  assert.equal(Math.round(T["2022"][1] / 1e6), 346);
  assert.equal(Math.round((T["2022"][0] + T["2022"][1]) / 1e6), 880);
  const h = read("farmland-atlas.html");
  assert.match(h, /if\(L\.key==='ten_rent'\) html=tenNatLine\(\)\+html;/);
  assert.match(read("components/atlas-tenure.js"), /window\.AgTenureData\?window\.AgTenureData\(\)/);
  assert.match(h, /atlas-tenure\.js\?v=3/);
});

test("in Chromium: #l=ten_rent shows the national line by the legend, and tenure.json loads once", { skip }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = []; let n = 0;
    pg.on("pageerror", (e) => errors.push(String(e)));
    pg.on("request", (r) => { if (r.url().includes("/data/tenure/tenure.json")) n++; });
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/farmland-atlas#l=ten_rent`);
    await pg.waitForSelector("#fa-legend .fa-natline", { timeout: 60000 });
    const t = await pg.textContent("#fa-legend .fa-natline");
    assert.equal(t, "39.3% of U.S. farmland was rented in 2022 (346 of 880 million acres); 40.3% in 1997. Census of Agriculture.");
    // the fold opens on this hash and draws from the same copy
    await pg.waitForFunction(() => !!document.querySelector("#fa-tenure-box table"), null, { timeout: 30000 });
    assert.equal(n, 1, `tenure.json requested ${n} times`);
    const y = await pg.$eval("#fa-legend .fa-natline", (e) => e.getBoundingClientRect().bottom + scrollY);
    assert.ok(y < 844, `the line is on the first phone screen (bottom at ${Math.round(y)})`);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
