/* One saved place (Nov 4, 2026, site panel): components/saved-place.js is the one reader of the place a
 * reader saved, for home, rent, ARC/PLC and custom rates.
 *
 * The real case (panel, shots/growth-home-zip-390.png): ZIP 50010 typed on /cash-bids, which wrote only
 * agsist_zip. The header said "Bids near 50010"; the home hero said "Set your ZIP to see local cash bids";
 * /rent/iowa opened at Clayton ($266, the middle county), not Story ($290), the county of the reader's ZIP.
 *
 * Browser runs block every outside host and service workers (build rule 58).
 *
 *   node --test test/saved-place.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const SP = require(ROOT + "components/saved-place.js");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function fakeWindow(items, zipTable) {
  const m = new Map(Object.entries(items || {}));
  const events = [];
  return {
    events,
    localStorage: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) },
    store: m,
    fetch: (u) => Promise.resolve({ ok: !!zipTable, json: () => Promise.resolve(zipTable) }),
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    dispatchEvent: (e) => events.push(e),
  };
}

test("a ZIP typed on /cash-bids (agsist_zip only) is the saved place, and sync() writes it where older readers look", () => {
  const w = fakeWindow({ agsist_zip: "50010" });
  const P = SP.bind(w);
  assert.deepEqual(P.read(), { zip: "50010", state: "", county: "", town: "", lat: null, lon: null, typed: true });
  assert.equal(P.sync(), true);
  const rec = JSON.parse(w.store.get("agsist-wx-loc"));
  assert.equal(rec.zip, "50010");
  assert.equal(rec.zipTyped, true);
  assert.equal(rec.lat, undefined, "no coordinates are made up; geo.js looks the ZIP up");
  assert.equal(P.sync(), false, "a second sync changes nothing");
});

test("a place found from the device keeps its own ZIP; a newer typed ZIP replaces an older typed one", () => {
  const gps = { lat: 44.9, lon: -91.4, label: "Chippewa Falls, WI", zip: "54729", state: "WI", county: "Chippewa County" };
  let P = SP.bind(fakeWindow({ agsist_zip: "50010", "agsist-wx-loc": JSON.stringify(gps) }));
  assert.equal(P.read().zip, "54729");
  assert.equal(P.read().county, "Chippewa", "the county word is dropped so it matches the rent and ARC/PLC lists");
  assert.equal(P.read().town, "Chippewa Falls");
  P = SP.bind(fakeWindow({ agsist_zip: "50010", "agsist-wx-loc": JSON.stringify({ ...gps, zipTyped: true }) }));
  assert.equal(P.read().zip, "50010", "every writer of the record writes both keys, so a different bare ZIP is the newer one");
  P = SP.bind(fakeWindow({ agsist_user_zip: "50201" }));
  assert.equal(P.read().zip, "50201");
  P = SP.bind(fakeWindow({}));
  assert.equal(P.read(), null);
  P = SP.bind(fakeWindow({ agsist_zip: "5001", "agsist-wx-loc": "{not json" }));
  assert.equal(P.read(), null);
});

test("full() fills town, state and county from our own ZIP table and writes them back", async () => {
  const w = fakeWindow({ agsist_zip: "50201" }, { "50201": [42.019, -93.4462, "Nevada", "IA", "Story"] });
  const P = SP.bind(w);
  P.sync();
  const p = await P.full();
  assert.equal(p.zip, "50201");
  assert.equal(p.state, "IA");
  assert.equal(p.county, "Story");
  assert.equal(p.town, "Nevada");
  const rec = JSON.parse(w.store.get("agsist-wx-loc"));
  assert.equal(rec.state, "IA");
  assert.equal(rec.county, "Story");
  assert.equal(rec.lat, 42.019);
  assert.equal(w.events.length, 1, "one agsist-place event");
});

test("save() writes both keys and the record at once", () => {
  const w = fakeWindow({ "agsist-wx-loc": JSON.stringify({ lat: 44.9, lon: -91.4, zip: "54729", state: "WI" }) });
  const P = SP.bind(w);
  assert.equal(P.save("50010"), true);
  assert.equal(w.store.get("agsist_zip"), "50010");
  assert.equal(w.store.get("agsist_user_zip"), "50010");
  assert.equal(JSON.parse(w.store.get("agsist-wx-loc")).zip, "50010");
  assert.equal(P.save("abc"), false);
});

test("home, rent, ARC/PLC and custom rates read the place through the one reader", () => {
  const idx = read("index.html");
  const at = idx.indexOf('<script src="/components/saved-place.js?v=1"></script>');
  assert.ok(at > 0 && at < idx.indexOf("localStorage.getItem('agsist-wx-loc')"), "loaded before the first reader on home");
  assert.match(read("components/home.js"), /AgSavedPlace\.read\(\)/);
  assert.match(read("components/custom-rates.js"), /window\.AgSavedPlace\.read\(\)/);
  assert.match(read("custom-rates.html"), /saved-place\.js\?v=1" defer><\/script>\s*<script src="\/components\/custom-rates\.js\?v=8"/);
  assert.match(read("components/arc-plc.js"), /w\.AgSavedPlace\.full\(\)/);
  assert.match(read("scripts/build_arc_plc.py"), /saved-place\.js\?v=\{SAVED_PLACE_V\}" defer><\/script>'\n\s+s \+= f'\\n<script src="\/components\/arc-plc\.js/);
  assert.match(read("scripts/build_state_rent_pages.py"), /SAVED_PLACE_JS = '<script src="\/components\/saved-place\.js\?v=1"><\/script>'/);
  assert.match(read("components/cash-bids.js"), /AgSavedPlace\.save\(zip\)/);
  assert.match(read("cash-bids.html"), /saved-place\.js\?v=1/);
});

function serve(extra) {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    else if (!extname(p)) p += ".html";
    let f = null;
    for (const [pre, dir] of extra || []) if (p.startsWith(pre)) { const g = normalize(join(dir, p.slice(pre.length))); if (existsSync(g)) f = g; }
    if (!f) f = normalize(join(ROOT, p));
    if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function pageWith(browser, port, items) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((it) => { try { if (!sessionStorage.getItem("seeded")) { for (const k in it) localStorage.setItem(k, it[k]); sessionStorage.setItem("seeded", "1"); } } catch (e) {} }, items);
  return [ctx, await ctx.newPage()];
}
const SHOTS = process.env.WAVE1B_SHOTS || "";

test("home at 390 with only a ZIP typed on /cash-bids: the hero and the header both start there", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const [ctx, pg] = await pageWith(browser, srv.address().port, { agsist_zip: "50010" });
    await pg.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: "domcontentloaded" });
    await pg.waitForFunction(() => { const e = document.getElementById("zip-chip-t"); return e && /Bids near/.test(e.textContent); }, null, { timeout: 15000 });
    await pg.waitForTimeout(1500);
    const hero = await pg.textContent("#hb-place");
    assert.doesNotMatch(hero, /Set your ZIP/, "the hero does not ask for a ZIP the reader already gave: " + hero);
    assert.equal(await pg.evaluate(() => document.getElementById("hero-band").classList.contains("hb-nozip")), false);
    const wx = await pg.evaluate(() => JSON.parse(localStorage.getItem("agsist-wx-loc") || "null"));
    assert.equal(wx && wx.zip, "50010");
    if (SHOTS) await pg.screenshot({ path: join(SHOTS, "home-saved-zip-390.png") });
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("/rent/iowa at 390 with ZIP 50201 saved: the calculator opens at Story, not the middle county (Clayton)", { skip }, async () => {
  const out = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "rent-"));
  execFileSync("python3", ["-c", "import sys;sys.path.insert(0,'scripts');import build_state_rent_pages as B;B.build_all(out_dir=sys.argv[1])", out], { cwd: ROOT, stdio: "pipe" });
  const srv = await serve([["/rent/", out]]);
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [items, want, own] of [[{ agsist_zip: "50201" }, "Story", true], [{}, "Clayton", false],
      [{ agsist_zip: "54729" }, "Clayton", false]]) {
      const [ctx, pg] = await pageWith(browser, srv.address().port, items);
      await pg.goto(`http://127.0.0.1:${srv.address().port}/rent/iowa`, { waitUntil: "load" });
      if (own) await pg.waitForFunction(() => !document.getElementById("gr-own").hidden, null, { timeout: 10000 });
      else await pg.waitForTimeout(800);
      const sel = await pg.evaluate(() => { const s = document.getElementById("gr-co"); return s.options[s.selectedIndex].textContent; });
      assert.equal(sel, want, JSON.stringify(items));
      if (own) {
        assert.match(await pg.textContent("#gr-out"), /Story County/);
        assert.match(await pg.textContent("#gr-own"), /Opened at Story County, from the ZIP saved on this browser/);
        if (SHOTS) { await pg.locator("#your-ground").scrollIntoViewIfNeeded(); await pg.locator("#your-ground").screenshot({ path: join(SHOTS, "rent-iowa-story-390.png") }); }
      }
      await ctx.close();
    }
    // a county the reader picks stays picked when the ZIP lookup answers late
    const [ctx, pg] = await pageWith(browser, srv.address().port, { agsist_zip: "50201" });
    await pg.route(/\/data\/places\/zip\/50\.json/, async (r) => { await new Promise((ok) => setTimeout(ok, 1200)); await r.continue(); });
    await pg.goto(`http://127.0.0.1:${srv.address().port}/rent/iowa`, { waitUntil: "load" });
    await pg.selectOption("#gr-co", { label: "Polk" });
    await pg.waitForTimeout(2000);
    assert.equal(await pg.evaluate(() => { const s = document.getElementById("gr-co"); return s.options[s.selectedIndex].textContent; }), "Polk");
    await ctx.close();
  } finally { await browser.close(); srv.close(); rmSync(out, { recursive: true, force: true }); }
});

test("ARC/PLC at 390 with ZIP 50201 saved: the calculator starts at Iowa and Story County; a state the reader picked before stays", { skip }, async () => {
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME });
  // the hub as scripts/build_arc_plc.py tail() writes it now: saved-place.js right before arc-plc.js
  const hub = read("arc-plc.html").replace(/<script src="\/components\/arc-plc\.js\?v=\d+" defer><\/script>/,
    '<script src="/components/saved-place.js?v=1" defer></script><script src="/components/arc-plc.js?v=16" defer></script>');
  assert.match(hub, /saved-place\.js\?v=1" defer><\/script><script src="\/components\/arc-plc\.js/);
  try {
    for (const [items, st, co] of [[{ agsist_zip: "50201" }, "IA", "19169"], [{ agsist_zip: "50201", "ap2:st": JSON.stringify("IL") }, "IL", ""], [{}, "", ""]]) {
      const [ctx, pg] = await pageWith(browser, srv.address().port, items);
      await pg.route(/\/arc-plc(\.html)?(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: hub }));
      await pg.goto(`http://127.0.0.1:${srv.address().port}/arc-plc`, { waitUntil: "load" });
      await pg.waitForFunction(() => { const s = document.getElementById("ap-st"); return s && s.options.length > 1; }, null, { timeout: 15000 });
      if (co) await pg.waitForFunction((c) => document.getElementById("ap-co").value === c, co, { timeout: 10000 });
      else await pg.waitForTimeout(1200);
      assert.equal(await pg.$eval("#ap-st", (e) => e.value), st, JSON.stringify(items));
      assert.equal(await pg.$eval("#ap-co", (e) => e.value), co, JSON.stringify(items));
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

