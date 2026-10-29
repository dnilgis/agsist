/**
 * Smoke render of the top pages (part of the PR checks' fixed core, scripts/dev/test_map.py CORE):
 * each opens in a phone-width browser with every outside host cut off, throws no uncaught error,
 * shows its heading and main text, and does not scroll sideways. Deeper checks live in each page's
 * own tests; this one is here so every pull request renders the pages most readers open.
 *   node --test test/smoke-top-pages.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGES = ["/", "/cash-bids", "/markets", "/rain", "/fast-facts", "/milk-prices", "/prf", "/daily", "/changelog", "/farmland-atlas"];
const FILES = { "/": "index.html", "/farmland-atlas": "farmland-atlas.html" };

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    let f = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
    if (f.endsWith("/")) f += "index.html";
    else if (existsSync(f + ".html")) f += ".html";   // /cash-bids is the page; cash-bids/ is its folder
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

test("the top pages are in the repo", () => {
  for (const p of PAGES) {
    const f = FILES[p] || p.slice(1) + ".html";
    assert.ok(existsSync(join(ROOT, f)), f);
  }
});

test("in a browser at 390: the top pages render with no uncaught error, a heading, main text and no sideways scroll", { skip, timeout: 240000 }, async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const b = await chromium.launch({ executablePath: CHROME });
  const bad = [];
  try {
    for (const p of PAGES) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await ctx.newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e && e.message || e).slice(0, 200)));
      // the document and its scripts; a request to a cut-off host or a slow data file does not hold it
      const resp = await page.goto(base + p, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({
        h1: (document.querySelector("h1") || {}).textContent || "",
        text: ((document.querySelector("main") || document.body).innerText || "").length,
        wide: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      if (!resp || resp.status() !== 200) bad.push(`${p}: status ${resp && resp.status()}`);
      if (errors.length) bad.push(`${p}: uncaught ${errors.join(" | ")}`);
      if (!r.h1.trim()) bad.push(`${p}: no h1`);
      if (r.text < 200) bad.push(`${p}: only ${r.text} characters of main text`);
      if (r.wide) bad.push(`${p}: scrolls sideways at 390`);
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  assert.deepEqual(bad, []);
});
