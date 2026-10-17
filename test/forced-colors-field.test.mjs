/* High contrast (forced colors), field audit 2026-10-17: the menu button showed an empty box
 * (its bars are background colors, which forced colors removes) and the picked crop chip on
 * /cash-bids looked like the others. Both get system colors under forced-colors: active.
 *
 *   node --test test/forced-colors-field.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the rules are there", () => {
  assert.match(read("components/header.html"), /@media \(forced-colors:active\)\{\s*\.hamburger \.h-bar\{forced-color-adjust:none;background:ButtonText;opacity:1\}/);
  assert.match(read("cash-bids.html"), /@media \(forced-colors:active\)\{\.cb-filt\[aria-pressed="true"\],\.cb-filt\.active,\.wtd-comm-btn\.active\{outline:3px solid Highlight;[^}]*border-color:Highlight;text-decoration:underline/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("forced colors at 390: menu bars drawn in a system color, the picked chip marked apart", { skip, timeout: 60000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, forcedColors: "active" });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/cash-bids`);
    await pg.waitForSelector("#hamburger .h-bar", { timeout: 15000 });
    const r = await pg.evaluate(() => {
      const bar = getComputedStyle(document.querySelector("#hamburger .h-bar"));
      const on = getComputedStyle(document.querySelector('.cb-filt[aria-pressed="true"]'));
      const off = getComputedStyle(document.querySelector('.cb-filt[aria-pressed="false"]'));
      return { bar: bar.backgroundColor, adj: bar.forcedColorAdjust, onDec: on.textDecorationLine, offDec: off.textDecorationLine, onB: on.borderTopColor, offB: off.borderTopColor };
    });
    assert.notEqual(r.bar, "rgba(0, 0, 0, 0)", "the bars have a color");
    assert.equal(r.adj, "none");
    assert.equal(r.onDec, "underline"); assert.equal(r.offDec, "none");
    assert.notEqual(r.onB, r.offB, "the picked chip's border differs");
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
