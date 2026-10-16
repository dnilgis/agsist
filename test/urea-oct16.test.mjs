/* /urea, Oct 16 benchmark fixes, worked by hand from the saved Montana State copies
 * (references branch: bench-urea-1 Soil Scoop, bench-urea-2 EB0209).
 *
 *   1. Half an inch or more forecast within 48 hours (today or tomorrow) turns the advice
 *      to "spread before the rain", with the chance; never "look for a wetter window".
 *      On no-till / heavy residue EB0209 says about 1.5 in within two days is needed, so
 *      0.60 in there is called partial.
 *   2. A light shower (under 1/4 in) scores the same in the headline as in the 5-day strip
 *      (rain term 88, the worst case). 72F, 60% RH, 8 mph, 0.08 in today:
 *        0.35*72 + 0.25*75 + 0.20*60 + 0.20*88 = 25.2 + 18.75 + 12 + 17.6 = 73.55 -> 74, High.
 *      Today's strip day, 75/55 (avg 65, temp term 50): 50*0.55 + 88*0.45 = 67.1 -> 67, High.
 *   3. The residue card follows the tillage picker.
 *   4. Timing and loss claims match the sources: two to three weeks (EB0209), 18% average
 *      and up to 44% for urea broadcast October to April (Soil Scoop). No "72 hours", no 16%.
 *
 *   node --test test/urea-oct16.test.mjs
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
async function open(browser, port, { admin1 = "Iowa", name = "Ames", sums = [0, 0, 0, 0, 0], pmax = [20, 20, 20, 20, 20], till = null, width = 1280 } = {}) {
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

test("half an inch tomorrow: spread before the rain, with the chance", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { sums: [0, 15.24, 0, 0, 0], pmax: [20, 70, 20, 20, 20] });
    const v = await txt(pg, "#risk-verdict");
    assert.match(v, /^Spread before the rain: 0\.60 in tomorrow forecast \(70% chance\)/);
    assert.doesNotMatch(v, /wetter window|Do not apply/);
    assert.equal(await txt(pg, "#rec-head"), "Spread Before the Rain");
    assert.doesNotMatch(await txt(pg, "#rec-text"), /delay|wetter/i);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no-till: 0.60 in is partial (1.5 in needed on residue); 1.6 in is enough", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const a = await open(browser, port, { sums: [0, 15.24, 0, 0, 0], till: "1.5" });
    assert.equal(await txt(a.pg, "#rec-head"), "Partial on Residue");
    assert.match(await txt(a.pg, "#risk-verdict"), /1\.5 in within two days/);
    await a.ctx.close();
    const b = await open(browser, port, { sums: [0, 40.64, 0, 0, 0], till: "1.5" });
    assert.match(await txt(b.pg, "#risk-verdict"), /^Spread before the rain: 1\.60 in tomorrow/);
  } finally { await browser.close(); srv.close(); }
});

test("a light shower scores the same way in the headline and the strip (74 and 67, both High)", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { sums: [2.032, 0, 0, 0, 0], pmax: [70, 20, 20, 20, 20] });
    assert.equal(await txt(pg, "#gauge-num"), "74");
    assert.match(await txt(pg, "#risk-verdict"), /0\.08 in today, a light shower/);
    const today = await pg.$eval("#fc-strip .fc-day", (e) => [e.title, e.querySelector(".fc-day-risk").textContent]);
    assert.match(today[0], /High Risk/);
    assert.equal(today[1], "HIG");
  } finally { await browser.close(); srv.close(); }
});

test("the residue card follows the tillage picker", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    assert.equal(await txt(pg, "#fs-res"), "NOT SET");
    await pg.selectOption("#in-till", "0.7");
    assert.equal(await txt(pg, "#fs-res"), "LOWER (tilled)");
    assert.match(await txt(pg, "#fd-res"), /0\.7/);
    await pg.selectOption("#in-till", "1.5");
    assert.equal(await txt(pg, "#fs-res"), "HIGH (no-till)");
    assert.match(await txt(pg, "#fd-res"), /1\.5 in of water within two days/);
  } finally { await browser.close(); srv.close(); }
});

test("timing and loss claims match the saved Montana State text", () => {
  assert.doesNotMatch(HTML, /72 hours|72-hour|first few days/);
  assert.doesNotMatch(HTML, /16%/);
  assert.doesNotMatch(HTML, /23 trials/);
  assert.doesNotMatch(HTML, /2 to 3 times more|two to three times more/);
  assert.match(HTML, /average 18% and up to 44%/);
  assert.match(HTML, /two to three weeks/);
  assert.match(HTML, /UvolBMPEB0209\.pdf/);
  assert.match(HTML, /soilscoop\/ss_uvol\.html/);
  // New lines carry no em dashes.
  for (const ln of HTML.split("\n").filter((l) => /Spread before the rain|Partial on Residue|LOWER \(tilled\)|two to three weeks/.test(l))) {
    assert.doesNotMatch(ln, /\u2014/);
  }
});
