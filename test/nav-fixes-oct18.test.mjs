/* Menu fixes, round 1 (Oct 18, 2026): the nav panel's fixes, not a new layout.
 *   - phone menu: aria-modal, focus stays inside, Escape closes, focus back to the menu button
 *   - dropdown buttons name their panel (aria-controls)
 *   - footer column names are not headings inside <summary>
 *   - footer-only tools are in the menu; Rain Print for business is in the footer
 *   - on phones the theme switch is in the menu panel, not the header
 *   - search: a ZIP goes to bids for that ZIP
 *
 *   node --test test/nav-fixes-oct18.test.mjs
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

const header = read("components/header.html"), footer = read("components/footer.html");
const NEW_MENU = ["/pod-counts", "/drought-monitor", "/planting-date", "/field-scout", "/urea"];

test("footer-only tools are in the desktop menu, the phone drawer and the no-script header", () => {
  // 2026-10-18 full menu: Drought monitor moved to Livestock, so look across the whole desktop menu
  const desk = header.slice(header.indexOf('class="nav-menu"'), header.indexOf('class="nav-actions"'));
  const drawer = header.slice(header.indexOf('id="drawer"'));
  const fb = read("components/header-fallback.html");
  for (const u of NEW_MENU) {
    assert.ok(desk.includes(`<a href="${u}">`), `${u} in the desktop menu`);
    assert.ok(drawer.includes(`<a href="${u}" class="draw-item">`), `${u} in the drawer`);
    assert.ok(fb.includes(`<a href="${u}">`), `${u} in header-fallback.html`);
  }
});

test("Rain Print for business is linked in the footer (live and no-script)", () => {
  assert.match(footer, /<a href="\/rain-print-business">[^\n]*Rain Print for business<\/a>/);
  assert.match(read("components/footer-fallback.html"), /<a href="\/rain-print-business">Rain Print for business<\/a>/);
  assert.ok(existsSync(join(ROOT, "rain-print-business.html")));
});

test("markup: aria-modal drawer, aria-controls on every dropdown, no heading in a footer <summary>", () => {
  assert.match(header, /<div class="drawer" id="drawer" aria-hidden="true" role="dialog" aria-modal="true"/);
  const btns = header.match(/<button class="nav-btn"[^>]*>/g);
  assert.equal(btns.length, 5, "Prices, Livestock, Field, Money & Land, Daily (2026-10-18)");
  for (const b of btns) {
    const id = /aria-controls="([^"]+)"/.exec(b)?.[1];
    assert.ok(id && header.includes(`id="${id}" class="nav-panel`), b);
  }
  assert.doesNotMatch(footer, /<summary>\s*<h\d/);
  assert.equal((footer.match(/<summary><span class="footer-h">/g) || []).length, 6, "Prices, Livestock, Field, Money & Land, Work with us, About (2026-10-18)");
  assert.match(header, /@media \(max-width:60em\)\{#theme-btn\{display:none\}\}/);
  assert.ok(header.includes('id="theme-btn-d"'), "the drawer keeps its own switch");
  for (const f of ["components/header.html", "components/footer.html", "components/search.js"]) {
    // what a reader sees: older code comments aside
    const seen = read(f).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(seen, /\u2014/, `${f}: no em dash`);
  }
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index";
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("keyboard: the phone menu traps focus, Escape closes it and focus returns to the menu button", { skip, timeout: 90000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    await pg.goto(`http://127.0.0.1:${port}/about`);
    await pg.waitForSelector("#hamburger", { state: "visible", timeout: 15000 });
    // the header theme switch is hidden at 390; the drawer has one
    assert.equal(await pg.isVisible("#theme-btn"), false, "no theme switch in the phone header");
    await pg.focus("#hamburger");
    await pg.keyboard.press("Enter");
    await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
    assert.equal(await pg.getAttribute("#drawer", "aria-modal"), "true");
    await pg.waitForFunction(() => document.getElementById("drawer").contains(document.activeElement));
    // 80 Tabs (more than every control in the drawer) never leave it
    for (let i = 0; i < 80; i++) {
      await pg.keyboard.press("Tab");
      assert.ok(await pg.evaluate(() => document.getElementById("drawer").contains(document.activeElement)), `Tab ${i + 1} left the drawer`);
    }
    for (let i = 0; i < 10; i++) {
      await pg.keyboard.press("Shift+Tab");
      assert.ok(await pg.evaluate(() => document.getElementById("drawer").contains(document.activeElement)), `Shift+Tab ${i + 1} left the drawer`);
    }
    // the theme switch is reachable in the drawer
    assert.ok(await pg.isVisible("#theme-btn-d"));
    await pg.keyboard.press("Escape");
    await pg.waitForFunction(() => !document.getElementById("drawer").classList.contains("open"));
    assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.id), "hamburger");
    assert.equal(await pg.getAttribute("#hamburger", "aria-expanded"), "false");
    // close button also hands focus back
    await pg.keyboard.press("Enter");
    await pg.waitForFunction(() => document.getElementById("drawer").classList.contains("open"));
    await pg.click("#draw-close");
    assert.equal(await pg.evaluate(() => document.activeElement && document.activeElement.id), "hamburger");
    await ctx.close();

    // desktop: the dropdown button names its panel; the theme switch stays in the header
    const ctx2 = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
    await ctx2.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p2 = await ctx2.newPage();
    await p2.goto(`http://127.0.0.1:${port}/about`);
    await p2.waitForSelector("#dd-field .nav-btn", { state: "visible", timeout: 15000 });
    assert.equal(await p2.isVisible("#theme-btn"), true);
    const ctl = await p2.getAttribute("#dd-field .nav-btn", "aria-controls");
    assert.equal(ctl, "dd-field-panel");
    await p2.click("#dd-field .nav-btn");
    assert.equal(await p2.getAttribute("#dd-field .nav-btn", "aria-expanded"), "true");
    await p2.waitForSelector('#dd-field-panel a[href="/field-scout"]', { state: "visible", timeout: 5000 });
    // search: a ZIP and Enter goes to bids for that ZIP
    await p2.keyboard.press("Escape");
    await p2.click("#srch-btn");
    await p2.waitForSelector("#srch-in", { state: "visible" });
    await p2.fill("#srch-in", "54728");
    await p2.waitForSelector('.srch-opt[href="/cash-bids?zip=54728"]', { timeout: 10000 });
    await Promise.all([p2.waitForURL(/\/cash-bids\?zip=54728$/), p2.keyboard.press("Enter")]);
    assert.equal(await p2.inputValue("#cb-zip"), "54728", "the bid page picked the ZIP up from the address");
    await ctx2.close();
  } finally { await browser.close(); srv.close(); }
});
