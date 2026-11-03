/* The home page's first screen (index.html paintFut, Dec corn and Nov beans) honors a move the
 * price run withheld. Nov 2, 2026 audit: fetch_prices energy_roll_guard (#255) marks a quote
 * whose day change crosses contracts with move_withheld and roll; home.js and the futures pages
 * print the price and "contract roll", but paintFut printed the phantom change. Fixture: the
 * Oct 17, 2026 price file with Dec corn marked as the guard marks it. Needs Playwright and
 * Chromium.
 *   node --test test/home-roll-first-screen.test.mjs
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
const FIX = JSON.parse(readFileSync(join(ROOT, "test/fixtures/chaosfix/prices-2026-10-17.json"), "utf8"));
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    const f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("home first screen: a withheld move shows the price and 'contract roll', no change", { skip, timeout: 120000 }, async () => {
  const fx = structuredClone(FIX);
  // as energy_roll_guard leaves it: the change vs another contract's close, withheld with a reason
  Object.assign(fx.quotes["corn-dec"], { netChange: 61.5, pctChange: 14.9, move_withheld: "contract roll near expiry", roll: true });
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 900 } });
    const pg = await ctx.newPage(), errs = [];
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
    await pg.route((u) => u.pathname === "/data/prices.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx) }));
    await pg.clock.setFixedTime(new Date("2026-10-17T17:00:00Z"));
    await pg.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await pg.waitForFunction(() => /settle/.test((document.getElementById("hb-fc-s") || {}).textContent || ""), null, { timeout: 15000 });
    assert.match(await pg.textContent("#hb-fc-v"), /^\$4\.74/, "the price still shows");
    const s = await pg.textContent("#hb-fc-s");
    assert.match(s, /contract roll/, s);
    assert.doesNotMatch(s, /61|▲|▼|up |down /, "no phantom change: " + s);
    assert.equal(await pg.$("#hb-fc-s .hb-ovn"), null, "no overnight move beside a withheld one");
    // beans, not withheld, keep their change
    const b = await pg.textContent("#hb-fs-s");
    assert.match(b, /down/, b);
    assert.doesNotMatch(b, /contract roll/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
