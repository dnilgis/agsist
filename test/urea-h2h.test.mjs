/* /urea in a real browser, the 2026-10-15 head-to-head fixes.
 *
 *   1. The place label uses the real postal code (Ames, IA), not the first
 *      two letters of the state name ("IO"; MN/MO/MS all came out "MI").
 *   2. The headline score uses the forecast rain AMOUNT for today and
 *      tomorrow, the same bands the 5-day strip uses: 0.5 in or more counts
 *      as incorporating rain, 0.25 to 0.5 as partial. Below that the chance
 *      of rain is used as before. The verdict names the day and the amount.
 *      72F, 60% RH, 8 mph: temp 72, humidity 75, wind 60.
 *        no rain amount: rain 70, 0.35*72+0.25*75+0.2*60+0.2*70 = 69.95 -> 70
 *        0.60 in tomorrow: rain 8 -> 57.55 -> 58
 *        0.30 in today: rain 35 -> 62.95 -> 63
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/urea-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/urea") p = "/urea.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const CORS = { "access-control-allow-origin": "*" };
async function open(browser, port, { admin1 = "Iowa", name = "Ames", sums = [0, 0, 0, 0, 0], width = 1280 } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (/geocoding-api\.open-meteo\.com/.test(u)) {
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json",
        body: JSON.stringify({ results: [{ name, admin1, latitude: 42.03, longitude: -93.62 }] }) });
    }
    if (/api\.open-meteo\.com\/v1\/forecast/.test(u)) {
      const hrs = [], hp = [];
      for (let i = 0; i < 120; i++) { hrs.push(new Date(Date.UTC(2026, 9, 15, 0) + i * 3600e3).toISOString().slice(0, 13) + ":00"); hp.push(20); }
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({
        current: { time: "2026-10-15T10:00", temperature_2m: 72, relative_humidity_2m: 60, apparent_temperature: 72, precipitation_probability: 20, weather_code: 1, wind_speed_10m: 8 },
        hourly: { time: hrs, precipitation_probability: hp },
        daily: { time: ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"], weather_code: [1, 61, 1, 1, 1],
          temperature_2m_max: [75, 75, 75, 75, 75], temperature_2m_min: [55, 55, 55, 55, 55],
          precipitation_probability_max: [20, 20, 20, 20, 20], precipitation_sum: sums } }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/urea`);
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await pg.waitForSelector("#btn-show-zip");
  await pg.$eval("#zip-row", (e) => { e.style.display = "flex"; });
  await pg.fill("#urea-zip", "50010");
  await pg.press("#urea-zip", "Enter");
  await pg.waitForFunction(() => /^\d+$/.test(document.getElementById("gauge-num").textContent.trim()));
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());

test("the place label uses the real postal code", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const [admin1, code] of [["Iowa", "IA"], ["Minnesota", "MN"], ["Missouri", "MO"], ["Mississippi", "MS"], ["Montana", "MT"], ["Kansas", "KS"], ["Texas", "TX"], ["Tennessee", "TN"], ["North Dakota", "ND"]]) {
      const { pg, errors, ctx } = await open(browser, port, { admin1 });
      assert.equal(await txt(pg, "#risk-location"), "Ames, " + code, admin1);
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("an unknown region name prints no made-up code", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { admin1: "Puerto Rico", name: "Ponce" });
    assert.equal(await txt(pg, "#risk-location"), "Ponce, PR");
    const b = await open(browser, port, { admin1: "Atlantis", name: "Town" });
    assert.equal(await txt(b.pg, "#risk-location"), "Town");
  } finally { await browser.close(); srv.close(); }
});

test("with no rain amount forecast the score is unchanged (70)", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    assert.equal(await txt(pg, "#gauge-num"), "70");
    assert.doesNotMatch(await txt(pg, "#risk-verdict"), / in (today|tomorrow)/);
  } finally { await browser.close(); srv.close(); }
});

test("half an inch or more tomorrow counts as incorporating rain in the headline", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { sums: [0, 15.24, 0, 0, 0] });
    assert.equal(await txt(pg, "#gauge-num"), "58");
    const v = await txt(pg, "#risk-verdict");
    assert.match(v, /0\.60 in/);
    assert.match(v, /tomorrow/);
    assert.match(v, /if it comes/);
    assert.match(await txt(pg, "#factor-section"), /0\.60 in tomorrow/);
  } finally { await browser.close(); srv.close(); }
});

test("a quarter to a half inch today counts as partial", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { sums: [7.62, 0, 0, 0, 0] });
    assert.equal(await txt(pg, "#gauge-num"), "63");
    assert.match(await txt(pg, "#risk-verdict"), /0\.30 in today/);
  } finally { await browser.close(); srv.close(); }
});
