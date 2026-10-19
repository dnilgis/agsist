/* A reader's larger default font is respected (a11y audit 2026-10-19, item 2).
 *
 * components/styles.css set `--base: 17px` on html, so a reader who set the
 * browser's default font to 24px still got 17px text on every page (desktop
 * is 58% of readers; that setting is their usual "make text bigger").
 * `--base: 106.25%` is 17px at the default 16px and 25.5px at 24px.
 *
 * Bigger text at 1280 wide made the desktop menu overrun the ZIP chip, so the
 * menu's fold point is 60em (960px at the default font) in styles.css and
 * components/header.html: it folds into the menu button sooner for that reader.
 *
 *   node --test test/a11y-font-size.test.mjs
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

test("the root size is relative and the menu folds in em, in every copy", () => {
  const css = read("components/styles.css");
  assert.match(css, /--base: 106\.25%;/);
  assert.doesNotMatch(css, /--base:\s*\d+px/, "a px --base ignores the reader's font setting");
  assert.match(css, /html \{[^}]*font-size: var\(--base\)/);
  for (const f of ["components/styles.css", "components/header.html", "scripts/dev/nav/gen_nav.py"])
    assert.doesNotMatch(read(f), /max-width: ?960px/, `${f}: the menu fold point is 60em now, a px one would overrun at a big font`);
  assert.match(css, /@media \(max-width: 60em\) \{ \.nav-menu \{ display: none \} \.hamburger \{ display: flex \} \}/);
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

test("default font 16 and 24 at 390 and 1280: text follows it, the header never overlaps", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) for (const fs of [16, 24]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 } });
      await ctx.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
      const pg = await ctx.newPage();
      const cdp = await ctx.newCDPSession(pg);
      await cdp.send("Page.enable");
      await cdp.send("Page.setFontSizes", { fontSizes: { standard: fs, fixed: Math.round(fs * 13 / 16) } });
      await pg.goto(`http://127.0.0.1:${port}/corn-futures-prices`, { waitUntil: "load" });
      await pg.waitForFunction(() => document.querySelector(".nav .hamburger"), null, { timeout: 20000 });
      await pg.waitForTimeout(300);
      const m = await pg.evaluate(() => {
        const vis = (el) => el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
        /* the header's own row: every visible direct child of the nav bar, left to right, must not overlap */
        const bar = document.querySelector(".nav-menu") ? document.querySelector(".nav-menu").parentElement : null;
        const boxes = bar ? [...bar.children].filter(vis).map((e) => e.getBoundingClientRect()).sort((a, b) => a.left - b.left) : [];
        let overlap = 0;
        for (let i = 1; i < boxes.length; i++) overlap = Math.max(overlap, boxes[i - 1].right - boxes[i].left);
        const menu = document.querySelector(".nav-menu");
        const items = menu && vis(menu) ? [...menu.querySelectorAll(".nav-btn, :scope > a")].filter(vis).map((e) => e.getBoundingClientRect()) : [];
        const rightOfMenu = boxes.filter((b) => menu && b.left >= menu.getBoundingClientRect().left + 1).map((b) => b.left);
        const menuEnd = items.length ? Math.max(...items.map((b) => b.right)) : 0;
        return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), n: boxes.length, overlap,
          menuShown: vis(menu), menuEnd, nextLeft: rightOfMenu.length ? Math.min(...rightOfMenu.filter((l) => l > menuEnd - 400)) : Infinity,
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      const tag = `${w}px wide, default font ${fs}px`;
      assert.equal(m.root, fs * 17 / 16, `${tag}: root is 106.25% of the reader's default`);
      assert.ok(m.n >= 2, `${tag}: found the header row (${m.n} items); the nav markup moved`);
      assert.ok(m.overlap <= 0.5, `${tag}: header items overlap by ${m.overlap.toFixed(1)}px`);
      assert.ok(m.sw <= m.cw, `${tag}: page scrolls sideways (${m.sw} > ${m.cw})`);
      if (w === 1280) assert.equal(m.menuShown, fs === 16, `${tag}: desktop menu ${fs === 16 ? "shows" : "folds into the menu button"}`);
      if (m.menuShown) assert.ok(m.menuEnd <= m.nextLeft + 0.5, `${tag}: the last menu item runs ${(m.menuEnd - m.nextLeft).toFixed(1)}px into the ZIP chip`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
