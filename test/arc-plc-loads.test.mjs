/* /arc-plc/<state>/<county>: what a county page downloads (2026-10-16 re-score: Story County, IA
 * pulled about 1.19 MB on open, with data/arc-plc/nav.json, 123 KB, fetched twice and
 * data/arc-plc/math/IA.json, 208 KB, fetched on every view though "Show the math" was closed).
 * Now: nav.json once; the math file only when the reader reaches for "Show the math", and then once,
 * and the math still draws.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/arc-plc-loads.test.mjs
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
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("Story County: nav.json once, no math file until 'Show the math' is reached for, then once and drawn", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const got = [];
    pg.on("request", (r) => { const u = r.url(); if (u.startsWith(`http://127.0.0.1:${port}`)) got.push(new URL(u).pathname); });
    await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    await pg.goto(`http://127.0.0.1:${port}/arc-plc/iowa/story-county.html`, { waitUntil: "load" });
    await pg.waitForTimeout(4500);   // past the idle fill (requestIdleCallback or 2 s)
    const n = (p) => got.filter((x) => x === p).length;
    assert.equal(n("/data/arc-plc/nav.json"), 1, "nav.json once");
    assert.equal(n("/data/arc-plc/math/IA.json"), 0, "no math file on load");
    await pg.click("#math > summary");
    await pg.waitForFunction(() => { const b = document.querySelector("#math .ap-mathb"); return b && !b.hasAttribute("aria-busy") && b.textContent.length > 200; });
    assert.equal(n("/data/arc-plc/math/IA.json"), 1, "math file once, on the tap");
    assert.match(await pg.$eval("#math .ap-mathb", (e) => e.textContent), /Story County|corn/i);
  } finally { await browser.close(); srv.close(); }
});
