/* Sources sections are closed until a reader opens them (Sig, Nov 5). Static: no page ships an open
 * Sources list, the text stays in the HTML. Browser (390 wide, every outside host refused, service workers
 * blocked, BUILD-RULES 58): closed on load, a tap target of 44 px, text of 12 px or more, #sources opens it,
 * opening shifts nothing above it. Browser checks need PLAYWRIGHT_PATH and CHROMIUM_PATH. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const FOLDED = [
  ["tar-spot.html", "sources"], ["commodity-loan.html", ""], ["combine-loss.html", ""], ["grain-shrink.html", ""],
  ["harvest-or-wait.html", ""], ["grain-bin-calculator.html", ""], ["fast-facts.html", "ff-sources-t"],
  ["farmland-atlas.html", ""], ["farmland-atlas/methods.html", "m-sources"], ["editorial-standards.html", "sources"],
  ["field-scout.html", "fs-src-h"],
];

test("each Sources section is a closed details with its heading and text in the HTML", () => {
  for (const [f, id] of FOLDED) {
    const h = read(f);
    const m = h.match(/<details class="src-fold">(<summary><h2[^>]*>[^<]*<\/h2><\/summary>)/);
    assert.ok(m, `${f}: no src-fold details`);
    assert.ok(!/<details class="src-fold"[^>]*\bopen\b/.test(h), `${f}: ships open`);
    if (id) assert.ok(m[1].includes(`id="${id}"`), `${f}: heading id kept`);
    assert.ok(h.includes('/components/src-fold.css?v=1') && h.includes('/components/src-fold.js?v=1'), `${f}: fold files`);
    assert.equal((h.match(/<details class="src-fold">/g) || []).length, (h.match(/<\/details>/g) || []).length - (h.match(/<details(?! class="src-fold")/g) || []).length, `${f}: details balanced`);
  }
});

test("no hand-written page or builder ships an open Sources details", () => {
  const files = [...readdirSync(ROOT).filter((f) => f.endsWith(".html")), ...readdirSync(join(ROOT, "scripts")).filter((f) => /^(build_|arc_plc).*\.py$/.test(f)).map((f) => "scripts/" + f)];
  for (const f of files) {
    const h = read(f);
    assert.ok(!/<details[^>]*\bopen\b[^>]*>\s*<summary>[^<]*Sources/i.test(h), `${f}: open Sources details`);
  }
});

test("the shared fold style: 44 px tap target, text 12 px or more", () => {
  const css = read("components/src-fold.css");
  assert.match(css, /min-height:44px/);
  for (const m of css.matchAll(/font-size:([\d.]+)rem/g)) assert.ok(Number(m[1]) * 16 >= 12);
});

test("the leaf drawing is gone from /tar-spot and the photo gallery leads How to identify it", () => {
  const h = read("tar-spot.html");
  assert.ok(!/ts-leaf/.test(h) && !/A drawing, not a photo/.test(h) && !/Drawing of a corn leaf/.test(h));
  const sec = h.slice(h.indexOf('<h2 id="identify">'), h.indexOf('<h2 id="scout">'));
  assert.ok(!/<svg/.test(sec));
  assert.ok(sec.indexOf('class="ts-gal"') > 0 && sec.indexOf('class="ts-gal"') < sec.indexOf("<p>Look for"));
  assert.ok(/^<h2 id="identify">[^<]*<\/h2>\s*<div class="ts-gal"/.test(sec));
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

test("in a browser at 390 wide Sources is closed, #sources opens it, nothing above shifts", { skip }, async () => {
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const path of ["/tar-spot", "/grain-shrink", "/fast-facts"]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      const pg = await ctx.newPage();
      await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
      await pg.goto(base + path, { waitUntil: "load" });
      const q = "details.src-fold";
      assert.equal(await pg.$eval(q, (d) => d.open), false, `${path} closed on load`);
      const s = await pg.$eval(q + ">summary", (e) => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e.querySelector("h2")).fontSize) }));
      assert.ok(s.h >= 44, `${path} tap target ${s.h}`);
      assert.ok(s.fs >= 12);
      assert.equal(await pg.$eval(q + " li", (e) => e.checkVisibility({ contentVisibilityAuto: true })), false, `${path} list hidden`);
      const top0 = await pg.$eval(q, (d) => d.getBoundingClientRect().top + scrollY);
      await pg.click(q + ">summary");
      assert.equal(await pg.$eval(q, (d) => d.open), true);
      assert.equal(await pg.$eval(q, (d) => d.getBoundingClientRect().top + scrollY), top0, `${path} opening moves the fold`);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} sideways scroll`);
      await ctx.close();
    }
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await pg.goto(base + "/tar-spot#sources", { waitUntil: "load" });
    assert.equal(await pg.$eval("details.src-fold", (d) => d.open), true, "#sources opens it on load");
    await pg.goto(base + "/editorial-standards", { waitUntil: "load" });
    assert.equal(await pg.$eval("details.src-fold", (d) => d.open), false);
    await pg.evaluate(() => { location.hash = "#cftc"; });
    await pg.waitForFunction(() => document.querySelector("details.src-fold").open);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
