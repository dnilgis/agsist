/* A ZIP set on the homepage carries to /cash-bids (panel A3, Oct 19, 2026).
 *
 * The homepage ZIP box saved only agsist-wx-loc (geo.js); /cash-bids ran on
 * load only from ?zip= or agsist_zip, so a farmer who saved Nevada, IA 50201
 * on the homepage and then opened /cash-bids from the footer, a bookmark or a
 * search got "Enter your ZIP code above". Now geo.js writes agsist_zip when it
 * saves a ZIP (a typed one always; one found from the map only when none is
 * saved), and cash-bids.js also reads a place geo.js saved before that.
 *
 *   node --test test/zip-carry.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function shareZip() {
  const src = read("components/geo.js");
  const m = src.match(/function _shareZip\(z, typed\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, "geo.js has _shareZip");
  const store = {};
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const ctx = vm.createContext({ localStorage: ls });
  vm.runInContext(m[0] + "\nthis._shareZip = _shareZip;", ctx);
  return { fn: ctx._shareZip, store };
}

test("geo.js: a typed ZIP always goes to agsist_zip; a map-found one only when none is saved", () => {
  const { fn, store } = shareZip();
  fn("50201", false);
  assert.equal(store.agsist_zip, "50201", "nothing saved yet: the found ZIP is kept");
  fn("50010", false);
  assert.equal(store.agsist_zip, "50201", "a found ZIP never replaces a saved one");
  fn("50010", true);
  assert.equal(store.agsist_zip, "50010", "a typed ZIP does");
  fn("", true); fn("5001", true); fn(null, true);
  assert.equal(store.agsist_zip, "50010", "no ZIP, no write");
});

test("geo.js: both places that save agsist-wx-loc also share the ZIP", () => {
  const src = read("components/geo.js");
  const saves = src.split("localStorage.setItem('agsist-wx-loc'").length - 1;
  const shares = (src.match(/localStorage\.setItem\('agsist-wx-loc', JSON\.stringify\((\w+)\)\);\n\s*_shareZip\(\1\.zip/g) || []).length;
  assert.equal(saves, 2);
  assert.equal(shares, saves, "every save is followed by _shareZip");
});

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (p.endsWith("/")) p += "index.html";
    else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function page(browser, port, init) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const pg = await ctx.newPage();
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith("https://geocoding-api.open-meteo.com/")) {
      return r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ results: [{ name: "Nevada", admin1: "Iowa", latitude: 42.0228, longitude: -93.4524 }] }) });
    }
    return u.startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort();
  });
  return { ctx, pg };
}

test("a ZIP typed on the homepage is the ZIP /cash-bids opens on", { skip, timeout: 90000 }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg } = await page(browser, port);
    await pg.goto(`http://127.0.0.1:${port}/`);
    await pg.waitForFunction(() => typeof window.agsistSetZip === "function", null, { timeout: 20000 });
    await pg.evaluate(() => window.agsistSetZip("50201"));
    await pg.waitForFunction(() => localStorage.getItem("agsist_zip") === "50201", null, { timeout: 15000 });
    await pg.goto(`http://127.0.0.1:${port}/cash-bids`);
    await pg.waitForFunction(() => (document.getElementById("cb-zip") || {}).value === "50201", null, { timeout: 15000 });
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});

test("/cash-bids opens on a place geo.js saved before agsist_zip existed", { skip, timeout: 60000 }, async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const saved = JSON.stringify({ lat: 42.0228, lon: -93.4524, label: "Nevada, IA", zip: "50201", state: "IA", zipTyped: true, ts: Date.now() });
    const { ctx, pg } = await page(browser, port, { fn: (s) => { try { if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", "1"); localStorage.setItem("agsist-wx-loc", s); } } catch (e) {} }, arg: saved });
    await pg.goto(`http://127.0.0.1:${port}/cash-bids`);
    await pg.waitForFunction(() => (document.getElementById("cb-zip") || {}).value === "50201", null, { timeout: 15000 });
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
});
