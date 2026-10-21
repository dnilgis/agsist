/* /spray wind view in a real browser, network mocked: a shared field link at
 * 390 and 1280 px, reduced motion, and each source failing on its own.
 * Skips without Playwright. Screenshots go to $SPRAY_SHOTS when it is set.
 *
 *   node --test test/spray-wind-browser.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { deflateSync } from "node:zlib";
import { fieldForecast, gridForecast, pageForecast, pad, addDays } from "./fixtures/spray-wind-forecast.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.SPRAY_SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* the field's clock: Iowa, UTC-5 in October */
const local = new Date(Date.now() - 5 * 3600e3);
const YMD = local.toISOString().slice(0, 10);
const NOWKEY = local.toISOString().slice(0, 13) + ":00";
const TOMORROW8 = addDays(YMD, 1) + "T08:00";
const IDX8 = Math.round((Date.parse(TOMORROW8 + "Z") - Date.parse(NOWKEY + "Z")) / 3600e3);

function png(w, h, rgb, at = () => null) { // a light, map-like tile (USGS cannot be reached from the test box)
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = at(x, y) || rgb; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const TILE = png(256, 256, [244, 243, 236], (x, y) => (x % 128 < 3 || y % 128 < 3) ? [205, 200, 190] : (Math.abs(y - 90 - 30 * Math.sin(x / 40)) < 2 ? [150, 190, 225] : (x > 160 && y > 150 && y < 230 ? [214, 232, 205] : null)));

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/spray") p = "/spray.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/* fail: a set of "grid", "field", "meta", "tiles" to answer 500 */
async function open(browser, port, { width, height, fail = new Set(), reduced = false, path }) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const pg = await ctx.newPage();
  const errors = [], asked = [], pageAsked = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  const json = (r, body) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  const bad = (r) => r.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: '{"error":true,"reason":"down"}' });
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.host === `127.0.0.1:${port}`) return r.continue();
    asked.push(u.href);
    if (u.host === "api.open-meteo.com" && u.pathname.endsWith("/meta.json")) return fail.has("meta") ? bad(r) : json(r, { last_run_initialisation_time: Math.floor(Date.now() / 1000 / 3600) * 3600 - 3 * 3600 });
    if (u.host === "api.open-meteo.com" && u.pathname === "/v1/forecast") {
      const lat = u.searchParams.get("latitude") || "";
      if (lat.includes(",")) return fail.has("grid") ? bad(r) : json(r, gridForecast(YMD));
      if (!u.searchParams.get("current")) return fail.has("field") ? bad(r) : json(r, fieldForecast(YMD));
      pageAsked.push(u.searchParams.get("models"));
      return json(r, pageForecast(YMD, NOWKEY));
    }
    if (u.host === "basemap.nationalmap.gov") return fail.has("tiles") ? r.fulfill({ status: 500, body: "" }) : r.fulfill({ status: 200, contentType: "image/png", body: TILE });
    if (u.host === "nominatim.openstreetmap.org") return json(r, { address: { town: "Ames", state: "Iowa", state_code: "IA" } });
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}${path}`);
  return { ctx, pg, errors, asked, pageAsked };
}

const SHARE = `/spray?f=42.03,-93.62&t=${TOMORROW8.slice(0, 13)}#wind`;

test("a shared field link at 390 and 1280: map, flow, windows, credits, the shared hour", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const counts = {};
    for (const [width, height] of [[390, 844], [1280, 900]]) {
      const { ctx, pg, errors, asked, pageAsked } = await open(browser, port, { width, height, path: SHARE });
      await pg.waitForSelector("#sw-list li.sw-li", { timeout: 15000 });
      // one story: the cards and the 24-hour strip ask for the same model as the wind view, named once for the page
      await pg.waitForFunction(() => /HRRR run .*GFS run /.test(document.getElementById("sp-model").textContent));
      assert.deepEqual([...new Set(pageAsked)], ["gfs_seamless"]);
      assert.ok(asked.filter((x) => x.includes("/v1/forecast")).every((x) => x.includes("models=gfs_seamless")), "every forecast call names gfs_seamless");
      const model = await pg.$eval("#sp-model", (e) => e.textContent);
      assert.match(model, /^Forecast \(estimate\) for everything on this page: NOAA HRRR for the first hours, then GFS, blended by Open-Meteo \(model gfs_seamless\)\. HRRR run .+, GFS run .+\.$/);
      assert.equal(await pg.evaluate(() => document.body.textContent.split("HRRR run").length - 1), 1, "the run time is named once");
      assert.equal(await pg.$$eval("#sp-model a", (as) => as[0].href), "https://open-meteo.com/");
      // the shared hour is the slider's hour
      assert.equal(+(await pg.$eval("#sw-slider", (e) => e.value)), IDX8, "slider at the shared hour");
      assert.match(await pg.$eval("#sw-read", (e) => e.textContent), /8 AM/);
      assert.equal(+(await pg.$eval("#sw-slider", (e) => e.max)), 47);
      assert.equal(await pg.$eval("#sw-wrap", (e) => e.getAttribute("data-mode")), "flow");
      counts[width] = +(await pg.$eval("#sw-wrap", (e) => e.getAttribute("data-particles")));
      assert.ok(counts[width] >= 100, "particles: " + counts[width]);
      // the windows list speaks in plain words
      const list = await pg.$$eval("#sw-list li", (ls) => ls.map((l) => l.textContent));
      assert.ok(list.some((t) => /^(Good: |No good hours|No spray window)/.test(t)), list.join(" | "));
      assert.ok(list.some((t) => /^Too windy /.test(t)), list.join(" | "));
      // every source on screen, linked
      const src = await pg.$eval("#sw-src", (e) => e.textContent);
      for (const s of ["Forecast (estimate): the same model and run as the rest of this page (gfs_seamless", "Open-Meteo", "CC BY 4.0", "USGS", "FAO-56", "Sprayers101", "SDSU Extension", "Check your product label"]) assert.ok(src.includes(s), s + " in: " + src);
      const links = await pg.$$eval("#sw-src a", (as) => as.map((a) => a.href));
      for (const h of ["https://open-meteo.com/", "sprayers101.com", "extension.sdstate.edu", "usgs.gov", "fao.org"]) assert.ok(links.some((l) => l.includes(h)), h);
      // nothing asked of anyone with a key, and the map came from USGS
      assert.ok(asked.some((u) => u.includes("basemap.nationalmap.gov")), "USGS tiles asked");
      assert.ok(!asked.some((u) => /key=|token=/i.test(u)));
      // the shared field is not saved as the reader's own
      assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-wx-loc")), null);
      // phone first: no sideways scroll
      assert.ok(await pg.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1), "no horizontal scroll");
      // share: the link carries the field and the hour
      await pg.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
      await pg.click("#sw-share");
      await pg.waitForFunction(() => window.__copied);
      const copied = await pg.evaluate(() => window.__copied);
      assert.equal(copied, `http://127.0.0.1:${port}/spray?f=42.03,-93.62&t=${TOMORROW8.slice(0, 13)}#wind`);
      // the slider moves the hour
      await pg.$eval("#sw-slider", (e) => { e.value = "0"; e.dispatchEvent(new Event("input", { bubbles: true })); });
      assert.match(await pg.$eval("#sw-slider", (e) => e.getAttribute("aria-valuetext")), /mph at the boom/);
      await pg.$eval("#sw-slider", (e, i) => { e.value = String(i); e.dispatchEvent(new Event("input", { bubbles: true })); }, IDX8);
      await pg.waitForTimeout(1500);
      // the wind is really drawn: the canvas fills the map box and carries coloured trails
      const drawn = await pg.$eval("#sw-cv", (c) => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return { n, w: c.clientWidth, h: c.clientHeight }; });
      assert.ok(drawn.h >= 280 && drawn.w >= 300, JSON.stringify(drawn));
      assert.ok(drawn.n > 2000, "trail pixels: " + drawn.n);
      if (SHOTS) {
        await pg.$eval("#wind", (e) => e.scrollIntoView({ block: "start" }));
        await pg.waitForTimeout(800);
        if (process.env.SPRAY_DEBUG) console.log(await pg.evaluate(() => { const S = window.AgSprayWind.state; return JSON.stringify({ raf: S.raf, vis: S.visible, hour: S.hour, n: S.parts.length, px: S.px, W: !!S.W }); }));
        await pg.locator("#wind").screenshot({ path: join(SHOTS, `wind-${width}.png`) });
      }
      assert.deepEqual(errors, []);
      await ctx.close();
    }
    assert.ok(counts[390] < counts[1280], `fewer particles on the phone: ${counts[390]} vs ${counts[1280]}`);
  } finally { await browser.close(); srv.close(); }
});

test("reduced motion: arrows instead of particles, and the inversion haze on a calm clear night", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const night = addDays(YMD, 1) + "T02";
    const { ctx, pg, errors } = await open(browser, port, { width: 390, height: 844, reduced: true, path: `/spray?f=42.03,-93.62&t=${night}#wind` });
    await pg.waitForSelector("#sw-list li.sw-li", { timeout: 15000 });
    assert.equal(await pg.$eval("#sw-wrap", (e) => e.getAttribute("data-mode")), "arrows");
    assert.equal(await pg.$eval("#sw-haze", (e) => e.hidden), false);
    assert.match(await pg.$eval("#sw-hz", (e) => e.textContent), /Inversion risk this hour.*A risk, not a reading/);
    assert.match(await pg.$eval("#sw-read", (e) => e.textContent), /2 AM/);
    if (SHOTS) { await pg.$eval("#wind", (e) => e.scrollIntoView({ block: "start" })); await pg.waitForTimeout(300); await pg.locator("#sw-wrap").screenshot({ path: join(SHOTS, "wind-390-reduced-night.png") }); }
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("each source failing on its own gets a plain line, and the rest still works", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // wind grid down: the map says so, the windows still come from the field forecast
    let o = await open(browser, port, { width: 390, height: 844, fail: new Set(["grid", "meta"]), path: SHARE });
    await o.pg.waitForFunction(() => { const d = document.getElementById("sw-down"); return d && !d.hidden; }, null, { timeout: 15000 });
    assert.match(await o.pg.$eval("#sw-down", (e) => e.textContent), /The wind map forecast is not answering right now \(Open-Meteo/);
    await o.pg.waitForSelector("#sw-list li.sw-li");
    await o.pg.waitForFunction(() => /HRRR run time not given by the source, GFS run time not given by the source/.test(document.getElementById("sp-model").textContent));
    assert.match(await o.pg.$eval("#sw-src", (e) => e.textContent), /Now: wind map forecast not answering/);
    if (SHOTS) { await o.pg.$eval("#wind", (e) => e.scrollIntoView({ block: "start" })); await o.pg.waitForTimeout(300); await o.pg.locator("#wind").screenshot({ path: join(SHOTS, "wind-390-grid-down.png") }); }
    assert.deepEqual(o.errors, []);
    await o.ctx.close();
    // field forecast down: no windows, a plain line and a retry; the map still flows
    o = await open(browser, port, { width: 390, height: 844, fail: new Set(["field"]), path: SHARE });
    await o.pg.waitForSelector("#sw-retry-f", { timeout: 15000 });
    assert.match(await o.pg.$eval("#sw-list", (e) => e.textContent), /The forecast for your field is not answering right now \(Open-Meteo/);
    assert.equal(await o.pg.$eval("#sw-down", (e) => e.hidden), true);
    assert.deepEqual(o.errors, []);
    await o.ctx.close();
    // map tiles down: the wind still draws, and the page says the map did not load
    o = await open(browser, port, { width: 390, height: 844, fail: new Set(["tiles"]), path: SHARE });
    await o.pg.waitForFunction(() => { const n = document.getElementById("sw-note"); return n && !n.hidden && /map underneath did not load/.test(n.textContent); }, null, { timeout: 15000 });
    assert.deepEqual(o.errors, []);
    await o.ctx.close();
  } finally { await browser.close(); srv.close(); }
});
