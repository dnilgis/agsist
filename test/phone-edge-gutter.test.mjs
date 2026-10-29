/* Phone side gutter for the Made by line and the Next block (Oct 27, 2026).
 *
 * On phones the "Made by Sigurd Lindquist, CCA" line (p.by-end) and the Next
 * cards (nav.next-links, drawn by components/next-links.js) sat flush against
 * the screen edge on every page whose <main> has no side padding: measured at
 * 390px before the fix, 47 of 90 placements had their text at x = 0 (/markets,
 * /cash-bids, /about, /glossary's Made by line, the custom rates state pages).
 * Pages whose own column is padded had them at 15 to 17px.
 *
 * The fix is one rule in components/styles.css: under 640px each gets side
 * padding that tops its gutter up to 16px. The padding reads its parent's
 * width (100%) against the screen (100vw), so a parent that already has a
 * 16px gutter adds nothing (no double gutter) and one with 12px adds 4px. A
 * Next block that next-links.js lined up with the block above (inline width)
 * keeps that alignment. Wide screens are left as they were.
 *
 *   node --test test/phone-edge-gutter.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("styles.css carries the one phone gutter rule for p.by-end and nav.next-links", () => {
  const css = read("components/styles.css");
  assert.ok(css.includes('@media (max-width: 640px) { p.by-end, nav.next-links:not([style*="width"]) { padding-left: max(0px, calc(16px - (100vw - 100%) / 2)); padding-right: max(0px, calc(16px - (100vw - 100%) / 2)) } }'));
  assert.ok(read("index.html").includes("/components/styles.css?v=28"), "styles.css ?v moved with the rule");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// [path, what must be there]; /urea's column is padded already (no double gutter)
const PAGES = [["/markets", ["p.by-end", "nav.next-links"]], ["/about", ["nav.next-links"]], ["/glossary", ["p.by-end", "nav.next-links"]],
  ["/urea", ["p.by-end", "nav.next-links"]], ["/custom-rates/iowa", ["p.by-end"]]];

async function textEdges(browser, port, path, width) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 844 } });
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  if (PAGES.find((p) => p[0] === path)[1].includes("nav.next-links")) await pg.waitForSelector("nav.next-links", { timeout: 20000 });
  const r = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll("p.by-end, nav.next-links")].map((e) => {
    const b = e.getBoundingClientRect(), cs = getComputedStyle(e), vw = document.documentElement.clientWidth;
    return [e.tagName.toLowerCase() + "." + e.className, { left: b.left + parseFloat(cs.paddingLeft), right: vw - b.right + parseFloat(cs.paddingRight), pad: parseFloat(cs.paddingLeft) }];
  })));
  await ctx.close();
  return r;
}

test("browser: at 390 the Made by line and the Next cards keep 12 to 18px from each edge; at 1280 they get no padding", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [path, want] of PAGES) {
      const r = await textEdges(browser, port, path, 390);
      for (const sel of want) {
        assert.ok(r[sel], `${path}: ${sel} is on the page`);
        for (const side of ["left", "right"]) assert.ok(r[sel][side] >= 12 && r[sel][side] <= 18, `${path} at 390: ${sel} text is ${r[sel][side].toFixed(1)}px from the ${side} edge`);
      }
      const w = await textEdges(browser, port, path, 1280);
      for (const sel of want) assert.equal(w[sel].pad, 0, `${path} at 1280: ${sel} unchanged on wide screens`);
    }
  } finally { await browser.close(); srv.close(); }
});
