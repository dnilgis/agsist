/* /planting-date in a real browser, the 2026-10-15 head-to-head fixes.
 *
 *   1. The GDU-before-frost card sets the hybrid's rating next to the GDUs a
 *      May 1 planting gets (2,626 and 2,139 to Sep 18 by default) and makes no
 *      maturity call: its inputs are rough zone averages (Oct 16 benchmark).
 *   (Soybean rows: corrected Oct 16 from an unsourced 0.2-0.5 band to the saved UW figure.)
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

// Oct 16 benchmark: the old maturity verdict told southern WI and MN growers their typical
// 108-day hybrid never reaches black layer, on frost and heat-unit inputs the page itself calls
// rough. Until those come from a station, the card sets the two numbers side by side and makes
// no maturity call in any zone.
test("no maturity call in any zone: the default hybrid gets numbers, not a verdict", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    const v = await txt(pg, "#cmp-verdict");
    // Central WI: May 1 to Sep 18 = 31x7.5 + 30x15.5 + 31x21.5 + 31x19.5 + 17x10 = 2,138.5.
    assert.match(v, /2,139/);
    assert.match(v, /108-day hybrid is rated about 2,626/); // 108 x 22 + 250
    assert.match(v, /Sep 18/);
    assert.match(v, /not a maturity call/);
    assert.match(v, /nearest station/);
    const zones = await pg.$$eval("#pd-zone option", (os) => os.map((o) => o.value));
    assert.ok(zones.length >= 4);
    for (const z of zones) {
      await pg.selectOption("#pd-zone", z);
      await pg.dispatchEvent("#pd-zone", "change");
      const t = await txt(pg, "#cmp-verdict");
      assert.doesNotMatch(t, /does not reach|short\b|reaches black layer|will not mature/, z + ": " + t);
      assert.match(t, /approximate numbers/);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("southern WI and MN: the hint's own 108-day hybrid is not called short", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    const zones = await pg.$$eval("#pd-zone option", (os) => os.map((o) => [o.value, o.textContent]));
    const south = zones.filter(([, t]) => /south/i.test(t));
    assert.ok(south.length >= 2, "southern WI and MN zones exist");
    for (const [z] of south) {
      await pg.selectOption("#pd-zone", z);
      await pg.dispatchEvent("#pd-zone", "change");
      const t = await txt(pg, "#cmp-verdict");
      assert.match(t, /2,626/);
      assert.doesNotMatch(t, /short|does not reach/);
    }
  } finally { await browser.close(); srv.close(); }
});

test("soybean penalty is UW's southern WI 2.1 bu/a a week past Apr 10, worked by hand", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    await pg.click("#pill-bean");
    await pg.waitForFunction(() => /Soybean Yield Penalty/.test(document.getElementById("penalty-section").textContent));
    const rows = await pg.$$eval("#penalty-section tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())));
    const row = (d) => rows.find((r) => r[0] === d);
    // Corrected Oct 16 to the saved UW source (uw-soy-pivot-mid-may): 2.1 bu/a a week past
    // roughly Apr 10 in southern WI = 0.3 bu/a a day, on a 55 bu/a example maximum.
    // May 5: 25 days x 0.3 = 7.5 bu. 55 - 7.5 = 47.5 -> 48 bu. 47.5/55 = 86.4% -> 86%.
    assert.equal(row("May 5")[2], "-7.5 bu/a");
    assert.equal(row("May 5")[3], "~48 bu/ac");
    assert.equal(row("May 5")[1], "86%");
    // Jun 15: 66 days x 0.3 = 19.8 bu. 55 - 19.8 = 35.2 -> 35 bu. 35.2/55 = 64%.
    assert.equal(row("Jun 15")[2], "-19.8 bu/a");
    assert.equal(row("Jun 15")[1], "64%");
    assert.match(row("Jun 15")[4], /66 days past Apr 10/);
    // May 1: 21 days x 0.3 = 6.3 bu; Apr 10 is UW's start, no loss.
    assert.equal(row("May 1")[2], "-6.3 bu/a");
    assert.equal(row("Apr 10")[2], "-");
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
