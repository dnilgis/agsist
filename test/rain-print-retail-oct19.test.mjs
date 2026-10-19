/* Rain Print retail fixes (2026-10-19, monetization board, Sig: "yeah fix please"):
 *   1. "Last year, by Christmas" beside "This year, in January": on the county
 *      rain pages (one promo block) and on the first screen of /rain-print,
 *      while a Christmas cutoff in data/rain-print.json is ahead;
 *   2. the gift box on the review sheet does not ask for the address Stripe takes;
 *   3. a second gift: "For someone else" keeps the town, year and style and clears the words;
 *   4. the wall picture keeps its honest "Mockup" label;
 *   5. the county month table fits a 390 px phone, "Vs usual" in view.
 * Browser cases need Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-retail-oct19.test.mjs
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
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// ---------------------------------------------------------------- 5. the month table at 390 px

test("5: the county month table fits a 390 px phone (Boone County, IA: 'Vs usual' was cut off)", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: "block" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    for (const p of ["rain/iowa/boone-county", "rain/texas/bowie-county", "rain/wisconsin/barron-county"]) {
      await page.goto(`http://127.0.0.1:${port}/${p}`);
      const m = await page.$eval(".rc-scroll", (s) => {
        const th = [...s.querySelectorAll("thead th")].pop().getBoundingClientRect(), box = s.getBoundingClientRect();
        return { cw: s.clientWidth, sw: s.scrollWidth, lastRight: th.right, boxRight: box.right, head: s.querySelector("thead").textContent };
      });
      assert.ok(m.sw <= m.cw, `${p}: the month table scrolls sideways (${m.sw} > ${m.cw})`);
      assert.ok(m.lastRight <= m.boxRight + 0.5, `${p}: the last column is in view`);
      assert.match(m.head, /Vs usual$/, p);
    }
  } finally { await browser.close(); srv.close(); }
});
