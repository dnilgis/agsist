/* Phone audit, Oct 19, 2026 (390 x 844): corn, soybean and wheat futures pages
 * shifted about 0.2 CLS when the live quotes arrived. Two causes:
 *   1. futures.js hid the baked .px-seed-note (62 px), so everything below
 *      jumped up. It now takes the live quote in place and keeps its box.
 *   2. the seed hid the new-crop line (corn-dec was the nearby Dec '26) that
 *      the page script then drew from the next Dec (Dec '27), pushing the
 *      page down. seed_static.new_crop_quote picks the same contract.
 * The fixture is the 06:16 UTC Oct 19 prices.json the audit ran on. Each page
 * is baked from it in a temp dir, then opened with prices.json held back
 * 1.5 s so the live fill lands after first paint, as on a phone.
 *
 *   node --test test/futures-seed-note-cls.test.mjs
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
const FIX = join(ROOT, "test/fixtures/phone/prices-2026-10-19.json");
const PAGES = ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html"];

function bake(prices) {
  const dir = mkdtempSync(join(os.tmpdir(), "fcls-"));
  for (const p of PAGES) copyFileSync(join(ROOT, p), join(dir, p));
  symlinkSync(join(ROOT, "data"), join(dir, "data")); // the "latest from USDA" line reads data/
  const py = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
os.chdir(${JSON.stringify(dir)})
import seed_static as s
s.seed_futures_pages(json.load(open(sys.argv[1])), '2026-10-19')
`;
  const f = join(dir, "prices.json");
  execFileSync("python3", ["-c", `import json,sys;open(${JSON.stringify(f)},'w').write(sys.argv[1])`, JSON.stringify(prices)]);
  execFileSync("python3", ["-c", py, f], { stdio: "pipe" });
  return dir;
}

test("the seed picks the new-crop contract the page script shows (Dec '27 while Dec '26 is nearby)", () => {
  const out = execFileSync("python3", ["-c", `
import sys, json
sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
import seed_static as s
q = json.load(open(${JSON.stringify(FIX)}))["quotes"]
print(s.new_crop_quote(q, "corn", "dec")["ticker"], s.new_crop_quote(q, "beans", "nov")["ticker"])
h = s.futures_hero_seeds("corn-futures-prices.html", {"quotes": q})["nc"]
print("hidden" if "display:none" in h else "shown")
`], { encoding: "utf8" }).trim().split("\n");
  assert.equal(out[0], "ZCZ27.CBT ZSX27.CBT");
  assert.equal(out[1], "shown");
});

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve(dir, prices) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p) && p !== "/") p += ".html";
    if (p === "/data/prices.json") {
      setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(prices)); }, 1500);
      return;
    }
    const base = PAGES.includes(p.slice(1)) ? dir : ROOT;
    const f = normalize(join(base, p));
    if (!f.startsWith(base) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function measure(browser, port, path) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(new Date("2026-10-19T06:30:00Z"));
  await pg.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
  await pg.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; (window.__src = window.__src || []).push(e.value.toFixed(3) + " " + (e.sources || []).map((s) => (s.node ? (s.node.id || s.node.className || s.node.nodeName) : "?") + " y" + Math.round(s.previousRect.y) + ">" + Math.round(s.currentRect.y)).join(", ")); } }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  await pg.waitForFunction(() => !/Loading/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  const r = await pg.evaluate(() => {
    const n = document.querySelector(".px-seed-note");
    return { src: window.__src, cls: window.__cls, note: n.textContent.trim(), shown: getComputedStyle(n).display !== "none", hero: document.getElementById("hero-price").textContent.trim() };
  });
  await ctx.close();
  return r;
}

test("browser: live quotes land with no layout shift on a phone, and the note says the live quote", { skip }, async () => {
  const prices = JSON.parse(readFileSync(FIX, "utf8"));
  const dir = bake(prices);
  const srv = await serve(dir, prices), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const corn = await measure(browser, port, "/corn-futures-prices");
    assert.ok(corn.cls < 0.1, "corn CLS " + corn.cls + " " + JSON.stringify(corn.src));
    assert.equal(corn.shown, true, "the note keeps its box");
    assert.match(corn.note, /^Nearby Dec '26 corn last traded near \$4\.73 · as of 1:16\sam CT\.$/);
    assert.equal(corn.hero, "$4.73");
    const soy = await measure(browser, port, "/soybean-futures-prices");
    assert.ok(soy.cls < 0.1, "soybean CLS " + soy.cls + " " + JSON.stringify(soy.src));
    assert.match(soy.note, /^Nearby Nov '26 soybeans last traded near \$12\.63¼ · as of /);
    const wheat = await measure(browser, port, "/wheat-futures-prices");
    assert.ok(wheat.cls < 0.1, "wheat CLS " + wheat.cls + " " + JSON.stringify(wheat.src));
    assert.doesNotMatch(wheat.note, /6\.60½|deferred/, "no baked second price under the live hero");
  } finally {
    await browser.close();
    srv.close();
  }
});

test("browser: a settle reads as a settle in the note (state_words)", { skip }, async () => {
  const prices = JSON.parse(readFileSync(FIX, "utf8"));
  const q = prices.quotes["corn-nearby"];
  Object.assign(q, { close_kind: "settle", settle_date: "2026-10-16", close_date: "2026-10-16" });
  const dir = bake(prices);
  const srv = await serve(dir, prices), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const corn = await measure(browser, port, "/corn-futures-prices");
    assert.equal(corn.note, "Nearby Dec '26 corn settled at $4.73 · as of Oct 16.");
    assert.ok(corn.cls < 0.1, "corn CLS " + corn.cls + " " + JSON.stringify(corn.src));
  } finally {
    await browser.close();
    srv.close();
  }
});
