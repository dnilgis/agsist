/* Cash bid town page layout jump (2026-11-09). The Updated stamp is written into the page as "Updated Nov 9, 7:50 am CT"
 * and rewritten by components/asof.js to "Updated 7:50 am" (or with a "1 day old" note). Inline with the call link it
 * changed the line count on a phone, so the bid table below moved (CLS 1.6e-2 at 390 px with slow scripts, text shift
 * at 1280 px). The stamp now has its own line (components/cash-bid-town.css), the separator dot is hidden.
 *
 *   node --test test/cash-bid-town-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CSS = readFileSync(ROOT + "components/cash-bid-town.css", "utf8");
const BUILDER = readFileSync(ROOT + "scripts/build_cash_bid_pages.py", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const PAGE = "/cash-bids/iowa/nevada";

test("the stamp is its own block and the builder marks the dot", () => {
  assert.match(CSS, /\.cbt-posted time\.asof\{display:block;/);
  assert.match(CSS, /\.cbt-sep\{display:none\}/);
  assert.match(BUILDER, /\{asof_time\(lo\)\}<span class="cbt-sep"> &middot; <\/span>\{call\}/);
});

for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
  test(`${w}px, slow scripts, outside hosts held then aborted: layout shift under 0.005`, { skip: skip || !existsSync(ROOT + PAGE.slice(1) + ".html") && "town page not built here", timeout: 120000 }, async () => {
    const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
    const srv = createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let f = normalize(join(ROOT, p));
      if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
      else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
      if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
      const slow = p.startsWith("/data/") ? 1500 : 800;
      setTimeout(() => { res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f)); }, slow);
    });
    await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
    const port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: mobile });
      await ctx.route("**/*", async (r) => {
        if (r.request().url().startsWith(`http://127.0.0.1:${port}`)) return r.continue();
        await new Promise((ok) => setTimeout(ok, 1500));
        return r.abort();
      });
      const pg = await ctx.newPage();
      await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
      await pg.goto(`http://127.0.0.1:${port}${PAGE}`, { waitUntil: "load" });
      await pg.waitForTimeout(5500);
      const cls = await pg.evaluate(() => window.__cls);
      assert.ok(cls < 0.005, `layout shift ${cls.toExponential(2)}`);
    } finally { await browser.close(); srv.close(); }
  });
}
