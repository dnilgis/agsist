/* chaos-1 on the homepage's first screen (index.html paintFut): on Jan 2 2027
 * the Oct 17, 2026 price file must not show the expired Dec '26 corn as a
 * live price. It rolls to Dec '27 corn and Nov '27 beans, each stamped with
 * its own settle date, year and age, and the cells grey. A 400-day-old file
 * names the year. Needs Playwright and Chromium; 390 and 1280.
 *   node --test test/chaosfix-home.test.mjs
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
const FIX = readFileSync(join(ROOT, "test/fixtures/chaosfix/prices-2026-10-17.json"), "utf8");
function shift(txt, days) {
  const ms = days * 864e5;
  return txt.replace(/\b(20\d\d)-(\d\d)-(\d\d)(T[\d:.]+(Z|[+-]\d\d:?\d\d)?)?/g, (m, y, mo, d, t) => new Date(Date.UTC(+y, +mo - 1, +d) - ms).toISOString().slice(0, 10) + (t || ""));
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function home(browser, port, w, clock, body) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
  await pg.route((u) => u.pathname === "/data/prices.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body }));
  await pg.clock.setFixedTime(new Date(clock));
  await pg.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
  await pg.waitForFunction(() => /settle/.test((document.getElementById("hb-fc-s") || {}).textContent || ""), null, { timeout: 15000 });
  return { ctx, pg, errs };
}

test("home: Jan 2 2027 rolls Dec '26 off the first screen and ages the settle", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await home(browser, port, w, "2027-01-02T17:00:00Z", FIX);
      assert.match(await pg.textContent("#hb-fc-k"), /^Dec .27 corn futures$/);
      assert.doesNotMatch(await pg.textContent("#hb-fc-k"), /26/);
      assert.match(await pg.textContent("#hb-fs-k"), /^Nov .27 bean futures$/);
      const s = await pg.textContent("#hb-fc-s");
      assert.match(s, /Oct 16, 2026 settle · 78 days old/, s);
      assert.doesNotMatch(s, /Last close/);
      assert.ok(await pg.$("#hb-fc.px-old"), "cell greyed");
      const hs = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(hs <= 0, "no sideways scroll at " + w);
      assert.deepEqual(errs, []);
      await ctx.close();
      const b = await home(browser, port, w, "2026-10-17T17:00:00Z", shift(FIX, 400));
      assert.match(await b.pg.textContent("#hb-fc-s"), /Sep 11, 2025 settle · 401 days old/);
      await b.ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
