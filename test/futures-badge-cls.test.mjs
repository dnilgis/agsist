/* Futures pages, Nov 9, 2026: #session-badge slid 8 to 16 px at every load on a wide screen (CLS about 1e-4 to
 * 1.4e-3). It is right aligned, so when futures.js replaced its skeleton with the real label (a different
 * width) its left edge moved. At 561 px and wider the badge now has one fixed box, the same before and after
 * the script writes it. The page is baked from the Oct 19 fixture like futures-seed-note-cls.test.mjs, with
 * scripts and CSS held 800 ms, prices.json 1.5 s, and outside hosts held then aborted.
 *
 *   node --test test/futures-badge-cls.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, copyFileSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import os from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FIX = join(ROOT, "test/fixtures/futures-badge/prices-2026-11-09.json"); // fetched 2026-11-09T17:01Z
const PAGES = ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html"];

test("every futures page gives the badge a fixed box from 561 px up", () => {
  for (const p of PAGES) {
    const h = readFileSync(join(ROOT, p), "utf8");
    assert.match(h, /@media\(min-width:561px\)\{\.session-badge\{[^}]*width:24rem/, p);
  }
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// pages are baked once per test from the fixture, as the scheduled seed does
function bake(prices) {
  const dir = mkdtempSync(join(os.tmpdir(), "fbcls-"));
  for (const p of PAGES) copyFileSync(join(ROOT, p), join(dir, p));
  symlinkSync(join(ROOT, "data"), join(dir, "data"));
  const f = join(dir, "prices.json");
  execFileSync("python3", ["-c", `import json,sys;open(${JSON.stringify(f)},'w').write(sys.argv[1])`, JSON.stringify(prices)]);
  execFileSync("python3", ["-c", `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
os.chdir(${JSON.stringify(dir)})
import seed_static as s
s.seed_futures_pages(json.load(open(sys.argv[1])), '2026-11-09')
`, f], { stdio: "pipe" });
  return dir;
}

function serve(dir, prices) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p) && p !== "/") p += ".html";
    const send = (b, t, ms) => setTimeout(() => { res.writeHead(200, { "content-type": t }); res.end(b); }, ms);
    if (p === "/data/prices.json") return send(JSON.stringify(prices), "application/json", 0);
    const base = PAGES.includes(p.slice(1)) ? dir : ROOT;
    const f = normalize(join(base, p));
    if (!f.startsWith(base) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    send(readFileSync(f), types[extname(f)] || "application/octet-stream", /\.(js|css)$/.test(f) ? 800 : 0);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function measure(browser, port, w, h, mobile, clock, path) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, isMobile: mobile, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date(clock));
  await pg.route("**/*", async (r) => {
    if (r.request().url().startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    await new Promise((ok) => setTimeout(ok, 1000));
    return r.abort();
  });
  await pg.addInitScript(() => {
    window.__cls = 0; window.__src = []; window.__boxes = new Set();
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__src.push((e.sources || []).map((s) => (s.node ? (s.node.id || s.node.className || s.node.nodeName) : "?") + " " + Math.round(e.startTime) + "ms x" + Math.round(s.previousRect.x) + ">" + Math.round(s.currentRect.x) + " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y) + " v" + e.value.toFixed(4)).join(", ")); } }).observe({ type: "layout-shift", buffered: true });
    const tick = () => {
      const b = document.getElementById("session-badge");
      if (b) { const r = b.getBoundingClientRect(); window.__boxes.add([r.x, r.y + scrollY, r.width, r.height].map((v) => v.toFixed(1)).join(",")); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await pg.goto(`http://127.0.0.1:${port}/${path}`);
  await pg.waitForFunction(() => !/Loading/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  const r = await pg.evaluate(() => ({ cls: window.__cls, src: window.__src, boxes: [...window.__boxes], text: document.getElementById("session-badge").textContent.trim() }));
  await ctx.close();
  return r;
}

const CLOCKS = ["2026-11-09T17:10:00Z"]; // day session open, quotes 9 minutes old
for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
  // wheat holds its KC and deferred card slots from first paint (the build writes them visible; a card with no quote is hidden by the build)
  for (const page of ["corn-futures-prices", "soybean-futures-prices", "wheat-futures-prices"]) test(`${page.split("-")[0]} page at ${w}px: CLS under 0.001 and the badge box does not move`, { skip, timeout: 120000 }, async () => {
    const prices = JSON.parse(readFileSync(FIX, "utf8"));
    const dir = bake(prices);
    const srv = await serve(dir, prices), port = srv.address().port;
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      for (const clock of CLOCKS) {
        const r = await measure(browser, port, w, h, mobile, clock, page);
        assert.ok(r.cls < 0.001, `${w}px ${clock} CLS ${r.cls} ${JSON.stringify(r.src)}`);
        assert.ok(!/Loading|^$/.test(r.text) && r.text.length > 8, "the badge was written: " + r.text);
        const xs = new Set(r.boxes.map((b) => b.split(",")[0])), ys = new Set(r.boxes.map((b) => b.split(",")[1]));
        assert.equal(xs.size, 1, `badge left edge moved ${JSON.stringify(r.boxes)}`);
        assert.equal(ys.size, 1, `badge top edge moved ${JSON.stringify(r.boxes)}`);
        if (w >= 561) assert.equal(r.boxes.length, 1, `badge box changed size ${JSON.stringify(r.boxes)}`);
      }
    } finally { await browser.close(); srv.close(); }
  });
}
