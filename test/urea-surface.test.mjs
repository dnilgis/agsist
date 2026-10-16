/* /urea, Oct 16 (gaps1): the soil surface in the score, so a dry surface reads lower, as the
 * page's own opening lines and Montana State EB0209 say (references branch: bench-urea-2).
 * EB0209 Table 2: moist soil or heavy dew high risk, dry soil lower, "soil moisture likely
 * being the most important risk condition"; Fig. 3: urea on dry soil "can remain undissolved for
 * at least a week"; losses 30 to 44% on wet surfaces that dried slowly, 10 to 20% on a dry surface.
 *
 * Worked by hand. 72F, 60% RH, 8 mph, 20% rain chance, no amount: temp 72, humidity 75, wind 60,
 * rain 70; 0.35*72 + 0.25*75 + 0.20*60 + 0.20*70 = 69.95 -> 70 before the surface.
 *   dry (0.10 m3/m3)   70 x 0.6 = 41.97 -> 42, Moderate
 *   moist (0.20)       70 x 1.0 = 70, High
 *   wet (0.35)         69.95 x 1.2 = 83.94 -> 84, Extreme
 *   no soil moisture   70 (multiplier 1), the card says so
 * Strip, Fri Oct 16, 75/55 (avg 65, temp 50), rain 70: (50*0.55 + 70*0.45) = 59; dry x 0.6 = 35.4 -> 35, Moderate.
 *
 *   node --test test/urea-surface.test.mjs
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
async function open(browser, port, { admin1 = "Iowa", name = "Ames", sums = [0, 0, 0, 0, 0], pmax = [20, 20, 20, 20, 20], till = null, width = 1280, sm = undefined } = {}) {
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
        hourly: sm === undefined ? { time: hrs, precipitation_probability: hp } : { time: hrs, precipitation_probability: hp, soil_moisture_0_to_1cm: hrs.map(() => sm) },
        daily: { time: ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"], weather_code: [1, 61, 1, 1, 1],
          temperature_2m_max: [75, 75, 75, 75, 75], temperature_2m_min: [55, 55, 55, 55, 55],
          precipitation_probability_max: pmax, precipitation_sum: sums } }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/urea`);
  await pg.evaluate((t) => { try { localStorage.clear(); if (t) localStorage.setItem("agsist-urea-field", JSON.stringify({ till: t })); } catch (e) {} }, till);
  if (till) await pg.reload();
  await pg.waitForSelector("#btn-show-zip");
  await pg.$eval("#zip-row", (e) => { e.style.display = "flex"; });
  await pg.fill("#urea-zip", "50010");
  await pg.press("#urea-zip", "Enter");
  await pg.waitForFunction(() => /^\d+$/.test(document.getElementById("gauge-num").textContent.trim()));
  return { pg, errors, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());



const HTML = readFileSync(ROOT + "urea.html", "utf8");

test("a dry surface reads lower: 42 Moderate, and the verdict says why", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { sm: 0.10 });
    assert.equal(await txt(pg, "#gauge-num"), "42");
    assert.match(await txt(pg, "#risk-badge"), /Moderate Risk/);
    assert.match(await txt(pg, "#risk-verdict"), /dry surface: urea on dry soil can sit undissolved for a week or more/);
    assert.equal(await txt(pg, "#fs-surf"), "LOWER (dry)");
    assert.match(await txt(pg, "#fv-surf"), /0\.10 m³\/m³, a model estimate/);
    const fri = await pg.$$eval("#fc-strip .fc-day", (els) => els[1].title);
    assert.match(fri, /surface dry · Moderate Risk/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("moist 70 High, wet 84 Extreme; no reading leaves the score as it was and says so", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const a = await open(browser, port, { sm: 0.20 });
    assert.equal(await txt(a.pg, "#gauge-num"), "70");
    assert.equal(await txt(a.pg, "#fs-surf"), "HIGH (moist)");
    assert.doesNotMatch(await txt(a.pg, "#risk-verdict"), /wetter window/);
    await a.ctx.close();
    const b = await open(browser, port, { sm: 0.35 });
    assert.equal(await txt(b.pg, "#gauge-num"), "84");
    assert.match(await txt(b.pg, "#risk-verdict"), /wet surface: the worst start, 30 to 44%/);
    await b.ctx.close();
    const c = await open(browser, port);
    assert.equal(await txt(c.pg, "#gauge-num"), "70");
    assert.equal(await txt(c.pg, "#fs-surf"), "NOT IN FORECAST");
  } finally { await browser.close(); srv.close(); }
});

test("what the farmer sees overrides the forecast: dry picked on a wet forecast gives 42", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { sm: 0.35 });
    await pg.selectOption("#in-surf", "dry");
    assert.equal(await txt(pg, "#gauge-num"), "42");
    assert.match(await txt(pg, "#fv-surf"), /your pick/);
    assert.match(await txt(pg, "#risk-verdict"), /You picked a dry surface/);
  } finally { await browser.close(); srv.close(); }
});

test("the page states the surface term, its source and that it is a rule of thumb", () => {
  assert.match(HTML, /soil_moisture_0_to_1cm/);
  assert.match(HTML, /then for the soil surface \(dry 0\.6, moist 1\.0, wet 1\.2/);
  assert.match(HTML, /Montana State calls surface moisture likely the most important condition/);
  assert.doesNotMatch(HTML, /actual soil surface moisture is not measured here/);
  assert.doesNotMatch(HTML, /cooler or wetter window/);
  const added = HTML.slice(HTML.indexOf("// Soil surface (2026-10-16)"), HTML.indexOf("function soilTempOverride("));
  assert.ok(added.length > 500 && !added.includes("\u2014"), "no em dash in the surface code and copy");
});
