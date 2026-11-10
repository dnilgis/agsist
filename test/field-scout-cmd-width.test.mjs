/* Field Scout: the layer column slid left while the page streamed in (2026-11-09). #fs-cmd-right sits at the right edge of
 * the map's top bar, so its left edge is the page width minus the width of its buttons. When the page arrived in two parts,
 * cut inside that column, the column was drawn with its first buttons only and moved left (3.4e-3 at 1280 px) when the rest
 * came. Its width is now held at the width of the full column (157 px); the column passes taps through except on its buttons.
 *
 *   node --test test/field-scout-cmd-width.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "field-scout.html", "utf8");
const CSS = readFileSync(ROOT + "components/field-scout.css", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the column holds its width and only its buttons take taps", () => {
  assert.match(CSS, /\.fs-cmd-right\{[^}]*min-width:157px[^}]*pointer-events:none/);
  assert.match(CSS, /\.fs-cmd-right>\*\{ pointer-events:auto; \}/);
  assert.match(CSS, /@media\(max-width:820px\)\{[\s\S]*?\.fs-cmd-right\{[^}]*min-width:0/);
  assert.match(HTML, /field-scout\.css\?v=5/);
});

test("1280px, the page cut at the first layer button, the rest 500 ms later: layout shift under 0.001", { skip, timeout: 120000 }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const file = ROOT + "field-scout.html";
  const mark = '<button id="fs-bm-sat" class="on" type="button">'; // inside the column, before its first word
  const cut = Buffer.byteLength(HTML.slice(0, HTML.indexOf(mark) + mark.length));
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    const buf = readFileSync(f);
    if (f === file) { res.write(buf.subarray(0, cut)); setTimeout(() => res.end(buf.subarray(cut)), 500); return; }
    res.end(buf);
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    await ctx.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
    const pg = await ctx.newPage();
    await pg.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await pg.goto(`http://127.0.0.1:${port}/field-scout`, { waitUntil: "load" });
    await pg.waitForTimeout(1500);
    const cls = await pg.evaluate(() => window.__cls);
    assert.ok(cls < 0.001, `layout shift ${cls.toExponential(2)}`);
  } finally { await browser.close(); srv.close(); }
});
