/* /prf in a real browser, the two places a reader used to be left with no
 * answer or the wrong one, and the two long sections folded on phones.
 *
 *   1. A link with a grid and no county (/prf?g=30454) opened on "pick the
 *      county" with no numbers. It now opens on the county holding the most of
 *      the grid and says so beside the county box.
 *   2. A search that found nothing left the last grid's figures on screen, and
 *      the pinned line still read "Example: 100 ac · you pay $150 ..." to
 *      someone who had typed a Texas town. The message and the pinned line now
 *      say whose figures they are.
 *   3. "How payouts compare with the premium" and "New for 2027" are closed on
 *      a phone, open on a wide screen, and open when a link points at one.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/prf-deadends.test.mjs
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
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/prf") p = "/prf.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function page(browser, port, path, width, geo) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (u.includes("geocoding-api.open-meteo.com") && geo) return geo(r);
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { pg, errors, ctx };
}

test("a link with a grid and no county opens on the county with the most of the grid, with figures, and says so", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await page(browser, port, "/prf?g=30454", 390);
    await pg.waitForSelector("#prf-answer .prf-figs", { timeout: 15000 });
    assert.equal(await pg.$eval("#prf-tool", (t) => t.classList.contains("is-nocounty")), false, "the tool is not waiting on a county");
    assert.equal(await pg.$eval("#prf-co", (s) => s.value), "55005", "Barron County holds the most of grid 30454");
    const how = await pg.textContent("#prf-co-how");
    assert.ok(how.includes("Opened on Barron County, which holds the largest part of this grid. If your land is in another county, pick it here."), how);
    assert.match(await pg.textContent("#prf-answer"), /\$\d/, "the answer has dollar figures");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a search that finds nothing says whose figures are still on screen, in the message and on the pinned line", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const fail of [(r) => r.abort(), (r) => r.fulfill({ contentType: "application/json", body: "{}" })]) {
      const { pg, errors, ctx } = await page(browser, port, "/prf", 390, fail);
      await pg.waitForSelector("#prf-app:not([hidden])");
      await pg.click("#prf-eg");
      await pg.waitForSelector("#prf-answer .prf-figs", { timeout: 15000 });
      assert.match(await pg.$eval("#prf-bar", (b) => b.textContent), /^Example: 100 ac/, "the pinned line starts as the example");
      await pg.fill("#prf-q", "Amarillo TX");
      await pg.click("#prf-find button[type=submit]");
      await pg.waitForFunction(() => /still for grid/.test(document.getElementById("prf-find-msg").textContent), null, { timeout: 10000 });
      const msg = await pg.textContent("#prf-find-msg");
      assert.ok(msg.endsWith("The figures below are still for grid 30454, Barron County, WI."), msg);
      const bar = await pg.$eval("#prf-bar", (b) => b.textContent);
      assert.ok(bar.startsWith("Still grid 30454, Barron WI: 100 ac"), bar);
      assert.ok(!bar.startsWith("Example"), bar);
      /* a new grid clears it */
      await pg.fill("#prf-q", "grid 30152");
      await pg.click("#prf-find button[type=submit]");
      await pg.waitForFunction(() => /^Grid 30152/.test(document.getElementById("prf-where-h").textContent));
      assert.ok(!(await pg.$eval("#prf-bar", (b) => b.textContent)).startsWith("Still"), "the label goes once a grid is found");
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("the two long sections are folded on a phone, open on a wide screen, and open when a link points at one", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const folds = (pg) => pg.$$eval("details.prf-fold", (ds) => ds.map((d) => [d.id, d.open]));
    let { pg, ctx } = await page(browser, port, "/prf", 390);
    await pg.waitForSelector("#prf-app:not([hidden])");
    assert.deepEqual(await folds(pg), [["payback-d", false], ["new-d", false]]);
    const summary = await pg.$eval("#new-d > summary", (s) => s.textContent);
    assert.ok(summary.startsWith("New for 2027"), "the heading stays visible: " + summary);
    await ctx.close();
    ({ pg, ctx } = await page(browser, port, "/prf#new", 390));
    await pg.waitForSelector("#prf-app:not([hidden])");
    assert.deepEqual(await folds(pg), [["payback-d", false], ["new-d", true]]);
    await ctx.close();
    ({ pg, ctx } = await page(browser, port, "/prf", 1280));
    await pg.waitForSelector("#prf-app:not([hidden])");
    assert.deepEqual(await folds(pg), [["payback-d", true], ["new-d", true]]);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
