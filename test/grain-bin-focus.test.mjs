/* Grain bin calculator: every input and select shows a focus ring (panel E6, 2026-10-20).
 * The page's own `outline: none` on :focus beat the sitewide :focus-visible ring, and the
 * border-color change it relied on did not show: computed style was the same focused or not.
 * Needs Playwright and Chromium for the rendered half; skipped where they are missing.
 *   node --test test/grain-bin-focus.test.mjs
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

test("grain-bin-calculator.html sets no outline: none on its inputs", () => {
  const css = readFileSync(ROOT + "grain-bin-calculator.html", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /outline\s*:\s*(none|0)\b/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("every bin input and select, reached with Tab, has a 2px ring, light and dark", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, colorScheme: theme });
      const pg = await ctx.newPage();
      await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      await pg.goto(`http://127.0.0.1:${port}/grain-bin-calculator.html`, { waitUntil: "load" });
      await pg.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const n = await pg.$$eval(".input-grid input:not([type=hidden]), .input-grid select, .crop-select", (els) => els.filter((e) => e.offsetParent).length);
      assert.ok(n >= 8, `${theme}: inputs found (${n})`);
      const seen = new Map();
      for (let i = 0; i < 120 && seen.size < n; i++) {
        await pg.keyboard.press("Tab");
        const r = await pg.evaluate(() => {
          const e = document.activeElement;
          if (!e || !e.matches(".input-grid input, .input-grid select, .crop-select")) return null;
          const s = getComputedStyle(e);
          return { id: e.id || e.name || e.outerHTML.slice(0, 60), style: s.outlineStyle, w: parseFloat(s.outlineWidth) };
        });
        if (r) seen.set(r.id, r);
      }
      assert.equal(seen.size, n, `${theme}: Tab reaches every input (${seen.size} of ${n})`);
      for (const r of seen.values()) assert.ok(r.style !== "none" && r.w >= 2, `${theme}: ${r.id} ring ${r.style} ${r.w}px`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
