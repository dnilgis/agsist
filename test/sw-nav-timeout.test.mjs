/* sw.js on a weak signal (panel E1, 2026-10-20). A page with a cached copy used to
 * show a blank screen for as long as the connection held the request open (25 s
 * and more): networkFirst had no time limit, only the shells and the data feeds did.
 * Now a navigation gives the network NAV_TIMEOUT_MS (3.5 s) and then serves the
 * cached copy; with no cached copy it keeps waiting, and the page arrives when the
 * network answers.
 *
 * The stall is a Playwright route that never answers (context.route sees the service
 * worker's own fetches once PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS is set).
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/sw-nav-timeout.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
// without this Playwright 1.56 routes only the page's requests, not the worker's own fetches
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("sw.js: the navigation limit is 3.5 s, used for HTML pages and old shell copies only", () => {
  const s = read("sw.js");
  assert.match(s, /var NAV_TIMEOUT_MS = 3500;/);
  assert.match(s, /if \(isShell\(url\)\) return shellFirst\(request, event\);\n\s+return networkFirst\(request, event\);/);
  assert.match(s, /return navRace\(answer, function\(\) \{ return cached \|\| caches\.match\(request\); \}, event\);/);
  assert.match(s, /\/\/ Everything else → network first\n\s+return networkFirst\(request\);/, "assets and other files keep plain network first");
});

test("stalled network: a cached page is served in under 3.5 s plus a little; an uncached page keeps waiting and then arrives", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port, base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const stalled = new Set(), held = [];
    await ctx.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin !== base) return r.abort();
      if (stalled.has(u.pathname)) { held.push(r); return; }   // never answered while stalled
      return r.continue();
    });
    const pg = await ctx.newPage();
    await pg.goto(`${base}/grain-bin-calculator`, { waitUntil: "load" });
    await pg.evaluate(async () => { await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready; });
    await pg.reload({ waitUntil: "load" });   // now controlled: this load goes through networkFirst and caches the page
    assert.ok(await pg.evaluate(() => !!navigator.serviceWorker.controller), "page is controlled by sw.js");
    await pg.waitForTimeout(500);

    stalled.add("/grain-bin-calculator");
    const t0 = Date.now();
    await pg.goto(`${base}/grain-bin-calculator`, { waitUntil: "domcontentloaded", timeout: 15000 });
    const ms = Date.now() - t0;
    assert.ok(held.length >= 1, "the stalled route held the request");
    assert.ok(ms >= 3000 && ms < 6000, `cached copy served after the 3.5 s limit (${ms} ms)`);
    assert.match(await pg.title(), /bin/i);

    // never visited, so nothing cached: no offline page, no error; it waits for the network
    stalled.add("/grain-shrink");
    const n0 = held.length;
    await assert.rejects(pg.goto(`${base}/grain-shrink`, { waitUntil: "domcontentloaded", timeout: 6000 }), /Timeout/);
    assert.ok(held.length > n0, "the uncached page's request is still open past the limit");
    stalled.clear();
    const late = held.splice(n0).map((r) => r.continue().catch(() => {}));
    await Promise.all(late);
    await pg.waitForURL(/grain-shrink/, { timeout: 10000 }).catch(() => {});
    await pg.goto(`${base}/grain-shrink`, { waitUntil: "domcontentloaded", timeout: 10000 });
    assert.match(await pg.title(), /shrink/i, "the late page arrives once the network answers");
  } finally {
    await browser.close(); srv.close();
  }
});
