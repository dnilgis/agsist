/* /drought-monitor in a real browser, the 2026-10-15 head-to-head fix:
 * a county lookup built only from data AGSIST already publishes.
 *   - The county list (farmland-atlas/data/counties-index.json) and the
 *     county's Atlas file (data/atlas/counties/<fips>.json) load only when
 *     the reader uses the box, never on page load.
 *   - It shows weeks with at least half the county in D2 or worse: this year
 *     so far, last year, and since 2000 with the worst year, straight from
 *     the county file, and links the Atlas county page and, when it exists,
 *     the county rain page.
 *   - A county the Atlas withholds says so and prints no numbers.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/drought-monitor-h2h.test.mjs
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

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const hits = [];
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/drought-monitor") p = "/drought-monitor.html";
    hits.push(p);
    if (!extname(p) && existsSync(join(ROOT, p + ".html"))) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  srv.hits = hits;
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, width = 1280) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/drought-monitor`);
  await pg.waitForSelector("#dm-county-q");
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
const county = (fips) => JSON.parse(readFileSync(ROOT + "data/atlas/counties/" + fips + ".json", "utf8")).drought;

async function pick(pg, q, label) {
  await pg.fill("#dm-county-q", q);
  await pg.dispatchEvent("#dm-county-q", "input");
  await pg.click(`#dm-county-list button:has-text("${label}")`);
  await pg.waitForFunction(() => /weekly maps|withheld|did not load/i.test(document.getElementById("dm-county-out").textContent));
}

test("nothing county-sized loads until the reader uses the box", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await pg.waitForTimeout(800);
    assert.ok(!srv.hits.some((h) => /counties-index|data\/atlas\/counties\//.test(h)), srv.hits.join(" "));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("Story County, IA: its drought weeks straight from the Atlas file, with links", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, 390);
    await pick(pg, "story", "Story County, IA");
    const d = county("19169"), out = await txt(pg, "#dm-county-out");
    const yr = String(d.partial_year.year);
    assert.match(out, new RegExp(`${yr} so far: ${d.partial_year.d2} of ${d.partial_year.maps} weekly maps`));
    const last = d.series[String(d.last_full_year)];
    assert.match(out, new RegExp(`${d.last_full_year}: ${last.d2} of ${last.maps}`));
    assert.match(out, new RegExp(`${d.weeks.d2.toLocaleString("en-US")} of ${d.weeks.counted.toLocaleString("en-US")}`));
    assert.match(out, new RegExp(`Worst year: ${d.worst_year.year}, ${d.worst_year.d2} weeks`));
    assert.match(out, /half/);
    assert.ok(await pg.$('#dm-county-out a[href="/farmland-atlas/iowa/story-county"]'), "Atlas link");
    await pg.waitForSelector('#dm-county-out a[href="/rain/iowa/story-county"]');
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "no sideways scroll at 390");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a county the Atlas withholds says so and prints no numbers", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    assert.notEqual(county("09007").status, "ok");
    await pick(pg, "middlesex", "Middlesex County, CT");
    const out = await txt(pg, "#dm-county-out");
    assert.match(out, /withheld/i);
    assert.doesNotMatch(out, /weekly maps/);
  } finally { await browser.close(); srv.close(); }
});
