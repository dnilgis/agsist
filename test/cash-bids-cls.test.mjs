/* /cash-bids layout jump (2026-11-09): a returning reader (saved ZIP) saw the empty-results block lose its held
 * table (about 390 px) and swap to the skeleton, shifting the email box, promo and links below #cb-results
 * (CLS about 0.1 to 0.17 at 1280 px, 0.02 at 390 px). #cb-results now keeps the empty state's height.
 *
 *   node --test test/cash-bids-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CB = readFileSync(ROOT + "cash-bids.html", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const FIX = {
  "/data/basis-states.json": readFileSync(ROOT + "test/fixtures/cash-bids-speed/basis-states.json"),
  "/data/prices.json": readFileSync(ROOT + "test/fixtures/alert-asks/prices.json"),
};
const CLOCK = Math.max(Date.parse(JSON.parse(FIX["/data/basis-states.json"]).generated), Date.parse(JSON.parse(FIX["/data/prices.json"]).fetched)) + 3600e3;

test("the results area reserves the empty state's height at every width", () => {
  assert.match(CB, /#cb-results\{min-height:\d+px\}/);
  assert.match(CB, /@media\(max-width:480px\)\{#cb-results\{min-height:\d+px\}\}/);
  assert.match(CB, /@media\(max-width:360px\)\{#cb-results\{min-height:\d+px\}\}/);
});

for (const [w, h, mobile, saved] of [[390, 844, true, false], [1280, 900, false, false], [390, 844, true, true], [1280, 900, false, true]]) {
  test(`${w}px, ${saved ? "saved ZIP" : "no ZIP"}, bids held: layout shift under 0.02`, { skip, timeout: 120000 }, async () => {
    const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
    const srv = createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const send = (b, t) => setTimeout(() => { res.writeHead(200, { "content-type": t }); res.end(b); }, p.startsWith("/data/") ? 1500 : 0);
      if (FIX[p]) return send(FIX[p], "application/json");
      let f = normalize(join(ROOT, p));
      if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
      else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
      if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
      send(readFileSync(f), types[extname(f)] || "application/octet-stream");
    });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: mobile });
      await ctx.clock.setFixedTime(new Date(CLOCK));
      // outside hosts (the bids network) are held, then fail: the page shows its skeleton and then its error state
      await ctx.route("**/*", async (r) => {
        if (r.request().url().startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        await new Promise((ok) => setTimeout(ok, 1500));
        return r.abort();
      });
      const pg = await ctx.newPage();
      if (saved) await pg.addInitScript(() => { try { localStorage.setItem("agsist_zip", "50010"); } catch (e) {} });
      await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
      await pg.goto(`http://127.0.0.1:${port}/cash-bids`, { waitUntil: "load" });
      await pg.waitForTimeout(5500);
      const cls = await pg.evaluate(() => window.__cls);
      assert.ok(cls < 0.02, `layout shift ${cls.toFixed(4)}`);
    } finally { await browser.close(); srv.close(); }
  });
}
