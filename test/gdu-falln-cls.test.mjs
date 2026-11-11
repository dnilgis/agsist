/* Layout jumps on /gdu-calculator and /fall-nitrogen (2026-11-09), found with a layout-shift observer under slow scripts
 * and CSS (800 ms), slow data (1500 ms), outside hosts held then aborted.
 *
 * /gdu-calculator: in September to November a small script moves the maturity card above the season gauge. It sat at the
 *   end of the page, so when the page painted in two parts the whole results column jumped once the card moved (1e-2 at
 *   1280 px). The maturity note and the stage list were also empty until the first calculation, so the buttons and
 *   cards under them dropped. The script now sits right after the results, and the empty places hold their room.
 * /fall-nitrogen: the county pickers were un-hidden when the readings arrived (display:none to 150 px), and the first
 *   line of the live block (a heading with a top margin) replaced the static lede, so the table moved down. The pickers
 *   keep their room, the block keeps its margins inside (flow-root) and never ends shorter than the static table.
 *
 *   node --test test/gdu-falln-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GDU = readFileSync(ROOT + "gdu-calculator.html", "utf8");
// /fall-nitrogen is the fall anhydrous tab of /spray since Nov 11, 2026: its markup is in spray.html, its style and code in components/fold/
const FN = ["spray.html", "components/fold/fall-nitrogen.css", "components/fold/fall-nitrogen.js"].map((f) => readFileSync(ROOT + f, "utf8")).join("\n");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("static guards: the reorder script follows the results, the empty places hold room, the pickers keep theirs", () => {
  assert.ok(GDU.indexOf("2026-10-16 audit") < GDU.indexOf('<aside class="ag-sponsor-ribbon" id="ag-sponsor" data-slot="gdu">'), "reorder script after the results, before the ribbon");
  assert.ok(GDU.indexOf("2026-10-16 audit") > GDU.indexOf('id="gdu-results"'));
  assert.match(GDU, /#r-mat-note \{ min-height:/);
  assert.match(GDU, /#milestones \{ min-height:/);
  assert.match(FN, /#fn-live\{display:flow-root\}/);
  assert.match(FN, /\.fn-pick\[hidden\]\{display:flex!important;visibility:hidden\}/);
  assert.match(FN, /live\.style\.minHeight = live\.offsetHeight/);
});

async function measure(page, w, h, mobile, twoParts) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    const ty = types[extname(f)] || "application/octet-stream";
    if (twoParts && p === page) { // the results are painted before the end of the page arrives
      const t = readFileSync(f, "utf8"), k = t.indexOf('<aside class="ag-sponsor-ribbon"');
      res.writeHead(200, { "content-type": ty }); res.write(t.slice(0, k)); setTimeout(() => res.end(t.slice(k)), 1200); return;
    }
    const slow = p.startsWith("/data/") ? 1500 : 800;
    setTimeout(() => { res.writeHead(200, { "content-type": ty }); res.end(readFileSync(f)); }, slow);
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
    await pg.goto(`http://127.0.0.1:${port}${page}`, { waitUntil: "load" });
    await pg.waitForTimeout(5500);
    return await pg.evaluate(() => window.__cls);
  } finally { await browser.close(); srv.close(); }
}

for (const [page, twoParts] of [["/gdu-calculator", false], ["/gdu-calculator", true], ["/spray#fall-nitrogen", false]]) {
  for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
    test(`${page}${twoParts ? " (painted in two parts)" : ""} at ${w}px: layout shift under 0.005`, { skip, timeout: 120000 }, async () => {
      const cls = await measure(page, w, h, mobile, twoParts);
      assert.ok(cls < 0.005, `layout shift ${cls.toExponential(2)}`);
    });
  }
}
