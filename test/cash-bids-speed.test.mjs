/* /cash-bids on a phone (2026-10-18 speed pass): before a ZIP, the page must
 * not jump. Two jumps were most of its layout shift (0.46 on Slow 4G):
 *   1. the bid email box drawn above the results, then moved below them at
 *      DOMContentLoaded; the placement script now runs right after #cb-results;
 *   2. the no-ZIP middle-bid table (components/cb-sample.js) pushing the page
 *      down when it landed; cash-bids.html now holds its place (#cb-sample).
 *
 *   node --test test/cash-bids-speed.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CB = readFileSync(ROOT + "cash-bids.html", "utf8");
const JS = readFileSync(ROOT + "components/cb-sample.js", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the table's place is held in the markup, inside the empty state, and hidden without scripts", () => {
  const empty = CB.indexOf('<div class="cb-empty">'), res = CB.indexOf('id="cb-results"');
  const hold = CB.indexOf('<div class="cb-sample cb-sample-wait" id="cb-sample" aria-hidden="true"></div>');
  assert.ok(res > 0 && empty > res && hold > empty, "placeholder inside #cb-results .cb-empty");
  assert.match(CB, /\.cb-sample-wait\{min-height:\d+px\}/);
  assert.match(CB, /<noscript><style>\.cb-sample-wait\{display:none\}<\/style><\/noscript>/);
  assert.match(JS, /getElementById\('cb-sample'\)/, "cb-sample.js fills the page's placeholder");
  assert.match(JS, /removeChild\(el\)/, "and removes it when there is no table");
  assert.match(JS, /setTimeout\(ok, 400\)/, "the table still waits for a saved ZIP search to start");
});

test("the email-box placement script runs right after the results area, at once", () => {
  const res = CB.indexOf('id="cb-results"'), slot = CB.indexOf("bid-alerts slot");
  assert.ok(slot > res, "placement script comes after #cb-results");
  const scr = CB.slice(CB.lastIndexOf("<script>", slot), CB.indexOf("</script>", slot));
  assert.ok(!/DOMContentLoaded/.test(scr), "no wait for DOMContentLoaded");
  assert.match(scr, /go\(\);\}\)\(\);$/);
});

test("no-ZIP load on a phone: the table shows and the page barely moves", { skip, timeout: 120000 }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await pg.goto(`http://127.0.0.1:${port}/cash-bids`, { waitUntil: "load" });
    await pg.waitForSelector("#cb-sample .cbs-t tbody tr", { timeout: 10000 });
    await pg.waitForTimeout(800);
    const [cls, wait] = await pg.evaluate(() => [window.__cls, document.querySelectorAll(".cb-sample-wait").length]);
    assert.equal(wait, 0, "placeholder class is gone once the table is in");
    assert.ok(cls < 0.1, `layout shift ${cls.toFixed(3)} (was 0.46 before the fix)`);
  } finally { await browser.close(); srv.close(); }
});
