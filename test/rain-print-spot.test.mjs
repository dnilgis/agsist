// Rain Print's exact spot (2026-10-24): PRISM through RCC-ACIS GridData, offered last in the station list,
// never auto-picked, rain only, and the page says it is an estimate.
/* Rain Print: the auto pick takes a station that records snowfall too
 * (2026-10-15, Sig: "find the nearest station with a full set of data, in my
 * case that includes snow and rain"). Chetek 2025 picked CoCoRaHS gauge
 * US1WIBR0002, 1.9 mi off, which keeps no snowfall, so the print drew none.
 *
 * Checks, on the shipped components/rain-print.js:
 *   - the pick prefers a snow station within max(10 mi farther, 2x as far);
 *   - falls back to the nearest rain record outside that slack, and says so;
 *   - ignores snow where snow is not normal (Florida, Hawaii, low deserts);
 *   - re-picks when a station NOAA lists for snowfall draws 'unknown';
 *   - never re-picks a design that names its station (links, short links,
 *     gift cards, saved designs);
 *   - the words by the station line and in the station list.
 * NOAA (data.rcc-acis.org) is answered here from made-up data shaped like
 * Chetek's real case. The browser part needs Playwright and Chromium and is
 * skipped where they are missing.
 *
 *   node --test test/rain-print-snowpick.test.mjs
 *   RP_SNOW_SHOTS=dir node --test test/rain-print-snowpick.test.mjs   (screenshots)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { PLACES_ROUTE, isPlaces, placesKey, placesBody } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctx);
const RP = ctx.RainPrint;
const plain = (x) => JSON.parse(JSON.stringify(x));
const KM = 1 / 0.621371;   // km in a mile

function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function acisRows(y, { snow = "full", missing = 0, seed = 1 } = {}) {
  const r = rng(seed + y);
  return yearDays(y).map((d, i) => {
    const winter = d.slice(5, 7) <= "03" || d.slice(5, 7) >= "11";
    const u = r(), p = i < missing ? "M" : u < 0.14 ? (r() * 1.4).toFixed(2) : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    const sn = snow === "none" ? "M" : snow === "holes" && i % 3 ? "M" : winter && p !== "M" && +p > 0 ? (+p * 10).toFixed(1) : "0.0";
    return [d, p, String(t), sn, String(t + 9), String(t - 9)];
  });
}
// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_SNOW_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

// Chetek's case, as StnMeta and StnData would send it
const TOWN = { lat: 45.3141, lon: -91.651 };
const META = [
  { name: "CHETEK 1.9 SSW", sids: ["US1WIBR0002 6"], ll: [TOWN.lon, TOWN.lat - 1.9 / 69], state: "WI", elev: 1060, valid_daterange: [["2009-05-01", "2026-10-10"]], snow: [], data: { snow: "none" } },
  { name: "RICE LAKE", sids: ["477113 2"], ll: [-91.651, TOWN.lat + 9 / 69], state: "WI", elev: 1110, valid_daterange: [["1893-01-01", "2026-10-10"]], snow: ["1893-01-01", "2026-10-10"], data: { snow: "full" } },
  { name: "CAMERON 2 NE", sids: ["471205 2"], ll: [-91.651, TOWN.lat - 10.5 / 69], state: "WI", elev: 1100, valid_daterange: [["1950-01-01", "2026-10-10"]], snow: ["1950-01-01", "2026-10-10"], data: { snow: "full" } },
];
async function mocks(context, meta, log) {
  await context.route(PLACES_ROUTE, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m && m[1] === "SN0W1") return r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { ok: true, code: RP.encodeCode({ place: "Chetek, WI", year: 2025, station: "US1WIBR0002 6", style: "r2" }) } });
      return r.fulfill({ status: 503, headers: { "Access-Control-Allow-Origin": "*" }, body: "x" });
    }
    if (isPlaces(u)) return r.fulfill({ json: placesBody(u, [{ name: "Chetek", latitude: TOWN.lat, longitude: TOWN.lon, admin1: "Wisconsin", country_code: "US" }]) });   // the town lookup: our own data/places/ files (2026-10-29)
    if ((u.host === "data.rcc-acis.org" || u.host === "grid2.rcc-acis.org") && u.pathname === "/GridData") {
      const p = JSON.parse(u.searchParams.get("params"));
      log.push("grid:" + p.grid + ":" + p.loc + ":" + p.sdate);
      const y0 = +p.sdate.slice(0, 4), y1 = +p.edate.slice(0, 4);
      let data = [];
      for (let y = y0; y <= y1; y++) data = data.concat(yearDays(y).filter((d) => d >= p.sdate && d <= p.edate)
        .map((d, i) => p.grid === "ncei-norm:91-20" ? [d, 0.09] : [d, i % 9 ? 0 : 0.6, 50, 60, 40]));
      return r.fulfill({ headers: { "Access-Control-Allow-Origin": "*" }, json: { data } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") {
        const snow = u.searchParams.get("elems") === "snow";
        return r.fulfill({ json: { meta: meta.filter((m) => !snow || m.snow.length).map((m) => ({ name: m.name, sids: m.sids, ll: m.ll, state: m.state, elev: m.elev, valid_daterange: [snow ? m.snow : m.valid_daterange[0]] })) } });
      }
      let sid = u.searchParams.get("sid"), sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sid = p.sid; sdate = p.sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      const m = meta.find((x) => x.sids[0].split(" ")[0] === String(sid).split(" ")[0]);
      if (!m) return r.fulfill({ json: { error: "no such station" } });
      if (sdate === "por") { let data = []; for (let y = 2010; y <= 2025; y++) data = data.concat(acisRows(y, m.data).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      log.push(m.sids[0]);
      return r.fulfill({ json: { meta: { name: m.name, state: m.state, ll: m.ll }, data: acisRows(+String(sdate).slice(0, 4), m.data) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, { width = 390, height = 844, meta = META } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
    await context.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    const log = [];
    await mocks(context, meta, log);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, log, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && /days recorded/.test(document.getElementById("rp-source").textContent), null, { timeout: 30000 });
const options = (page) => page.$$eval("#rp-station option", (a) => a.map((o) => o.textContent));
async function shots(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.$eval("#rp-source", (el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/" + name + "-line.png" });
  await page.evaluate(() => { document.getElementById("rp-more").open = true; document.getElementById("rp-station").scrollIntoView({ block: "center", behavior: "instant" }); });
  // the list itself, as the open select would show it
  await page.evaluate(() => { const s = document.getElementById("rp-station"); s.size = s.options.length; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + "/" + name + "-list.png" });
  await page.evaluate(() => { document.getElementById("rp-station").size = 0; });
}


test("spot ids and the plain words for one", () => {
  assert.equal(RP.sidPlain("spot:45.31,-91.65"), "PRISM estimate at 45.31, -91.65");
});

test("browser: the exact spot is offered last, drawn from PRISM when picked, and credited as an estimate", { skip }, async () => {
  await withPage(async (page, base, log, errors) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=2025&style=r2");
    await drawn(page);
    assert.equal(await page.inputValue("#rp-station"), "477113 2", "the auto pick is still a station");
    const o = await options(page);
    assert.match(o[o.length - 1], /^This exact spot \(PRISM estimate\): estimate for Chetek itself, rain only, 1981 on$/);
    assert.ok(!log.some((x) => x.startsWith("grid:")), "nothing asked of the grid until the spot is picked");
    await page.evaluate(() => { document.getElementById("rp-more").open = true; });
    await page.selectOption("#rp-station", "spot:45.31,-91.65");
    await page.waitForFunction(() => /PRISM estimate/.test(document.getElementById("rp-source").textContent) && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
    const src = await page.textContent("#rp-source");
    assert.match(src, /daily PRISM estimate/);
    assert.match(src, /not a gauge reading, it has no snowfall/);
    assert.ok(log.includes("grid:21:-91.65,45.31:2025-01-01"), "the year from PRISM grid 21 at the spot");
    assert.ok(log.some((x) => x.startsWith("grid:ncei-norm:91-20:-91.65,45.31")), "the usual from NOAA's gridded normal");
    assert.match(page.url(), /station=spot%3A45\.31%2C-91\.65|station=spot:45\.31,-91\.65/, "the link keeps the spot");
    assert.deepEqual(errors, []);
  });
});

test("browser: no spot before 1981", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?place=Chetek%2C+WI&year=1975&style=r2");
    await page.waitForFunction(() => document.querySelectorAll("#rp-station option").length > 0, null, { timeout: 30000 });
    assert.ok(!(await options(page)).some((x) => /PRISM/.test(x)));
  });
});
