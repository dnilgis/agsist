/* /planting-date in a real browser, the 2026-10-15 head-to-head fixes.
 *
 *   1. The GDU-before-frost card says plainly when the hybrid in the box
 *      falls short. The default (108-day corn, central WI) needs 2,626 on the
 *      page's own line, and a May 1 planting gets 2,139 to Sep 18, so the page
 *      must say it does not reach black layer before that frost date.
 *   2. The card says its fall frost dates are approximate and unchecked
 *      against a station (the spring ones run about 13 days early), and
 *      prints no raw "&asymp;" (the note is set as text).
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/planting-date-h2h.test.mjs
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
    if (p === "/planting-date") p = "/planting-date.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function open(browser, port, width = 1280) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}/planting-date`);
  await pg.waitForFunction(() => document.getElementById("cmp-grid").textContent.trim() !== "");
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());
async function type(pg, sel, v) { await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, "input"); }

test("the default hybrid is called short of black layer before the zone frost", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    const v = await txt(pg, "#cmp-verdict");
    assert.match(v, /108-day/);
    assert.match(v, /does not reach black layer/);
    assert.match(v, /2,626/);
    assert.match(v, /2,139/);
    assert.match(v, /487 short/);
    assert.match(v, /Sep 18/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a hybrid that fits says which planting dates make it", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    // 85-day: 85 x 22 + 250 = 2,120. May 1 gets 2,139, May 10 gets 2,071.
    await type(pg, "#pd-rm", 85);
    const v = await txt(pg, "#cmp-verdict");
    assert.match(v, /2,120/);
    assert.match(v, /May 1/);
    assert.match(v, /May 10.*short|short.*May 10/);
    // 75-day: 1,900. Jun 1 gets 465 + 666.5 + 604.5 + 170 = 1,906, the lowest of the four.
    await type(pg, "#pd-rm", 75);
    assert.match(await txt(pg, "#cmp-verdict"), /every planting date/);
  } finally { await browser.close(); srv.close(); }
});

test("the card says the fall frost dates are approximate and unchecked", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    const n = await txt(pg, "#cmp-note");
    assert.match(n, /approximate/);
    assert.match(n, /13 days/);
    assert.match(n, /not been checked against a station/);
    assert.doesNotMatch(n, /&[a-z]+;/, "no raw HTML entities in a textContent note");
  } finally { await browser.close(); srv.close(); }
});
