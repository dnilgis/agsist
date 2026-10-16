/* /gdu-calculator, Oct 16 benchmark fixes.
 *
 *   1. After a fetch, the freeze box fills with the typical first 28F freeze at that spot,
 *      from the 1991-2020 daily lows the page already downloads for its normal. Labeled as
 *      a grid-cell median, not a station, and editable; a date the farmer typed is kept,
 *      and the filled-in date is never saved or shared.
 *      Hand case: in year Y (1991-2020) the first low at or below 28F is Oct (1 + Y - 1991),
 *      so the 30 first-freeze dates are Oct 1 to Oct 30. The two middle years are Oct 15
 *      and Oct 16; the middle of those, rounded down, is Oct 15.
 *   2. On a phone (390 px) the answer moves above the setup after a fetch.
 *
 *   node --test test/gdu-freeze-phone.test.mjs
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
    if (p === "/gdu-calculator") p = "/gdu-calculator.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

const CORS = { "access-control-allow-origin": "*" };
/* weather(dateISO) -> [hi, lo] or null for a missing day. */
async function open(browser, port, { weather = () => [84, 62], state = "Iowa", width = 1280, normals = "ok" } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [], calls = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    if (/nominatim\.openstreetmap\.org/.test(u)) {
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json",
        body: JSON.stringify([{ lat: "42.03", lon: "-93.62", display_name: "Ames, Story County, " + state, address: { state } }]) });
    }
    if (/open-meteo\.com/.test(u)) {
      calls.push(u);
      const q = new URL(u).searchParams;
      const s = new Date(q.get("start_date") + "T00:00:00Z"), e = new Date(q.get("end_date") + "T00:00:00Z");
      const t = [], mx = [], mn = [];
      for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10), w = weather(iso, u);
        t.push(iso); mx.push(w ? w[0] : null); mn.push(w ? w[1] : null);
      }
      if (/start_date=1991/.test(u) && normals === "fail") return r.fulfill({ status: 500, headers: CORS, body: "" });
      return r.fulfill({ status: 200, headers: CORS, contentType: "application/json",
        body: JSON.stringify({ daily: { time: t, temperature_2m_max: mx, temperature_2m_min: mn } }) });
    }
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/gdu-calculator`);
  await pg.waitForFunction(() => document.getElementById("r-target").textContent.trim() !== "");
  return { pg, errors, calls, ctx };
}
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.trim());
async function type(pg, sel, v) { await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, "input"); }
async function setup(pg, { plant, end, frost, rm = 108 }) {
  await type(pg, "#g-rm", rm);
  await type(pg, "#g-plant", plant);
  await type(pg, "#g-today", end);
  if (frost) { await type(pg, "#g-frost", frost); await pg.dispatchEvent("#g-frost", "change"); }
}
async function fetchWeather(pg) {
  await type(pg, "#g-zip", "50010");
  await pg.click("#g-fetch-btn");
  await pg.waitForFunction(() => /Real data|✗/.test(document.getElementById("g-fetch-status").textContent));
}


// Lows: 62 until the year's first freeze day, 25 from then on (Jul-Dec); 84 highs.
function wx(iso) {
  const y = +iso.slice(0, 4);
  if (y >= 1991 && y <= 2020 && iso.slice(5) >= "07-01") {
    const first = `${y}-10-${String(1 + y - 1991).padStart(2, "0")}`;
    return iso >= first ? [40, 25] : [84, 62];
  }
  return [84, 62];
}

test("the freeze box fills with the typical first 28F freeze, labeled and editable", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { weather: wx });
    await pg.evaluate(() => localStorage.clear());
    await setup(pg, { plant: "2026-05-01", end: "2026-08-01" });
    assert.equal(await pg.$eval("#g-frost", (e) => e.value), "");
    await fetchWeather(pg);
    assert.equal(await pg.$eval("#g-frost", (e) => e.value), "2026-10-15");
    const h = await txt(pg, "#g-frost-hint");
    assert.match(h, /Typical first 28°F freeze here: Oct 15/);
    assert.match(h, /1991–2020/);
    assert.match(h, /not a station/);
    assert.match(h, /Change it to yours/);
    assert.doesNotMatch(h, /\u2014/);
    // The frost verdict uses it like a typed date.
    assert.notEqual(await txt(pg, "#r-frost-verdict"), "Add freeze date");
    // Not saved and not shared.
    const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem("agsist_gdu") || "{}"));
    assert.equal(saved.frost || "", "");
    // A farmer's own date wins, is saved, and a second fetch leaves it alone.
    await type(pg, "#g-frost", "2026-09-28");
    const saved2 = await pg.evaluate(() => JSON.parse(localStorage.getItem("agsist_gdu") || "{}"));
    assert.equal(saved2.frost, "2026-09-28");
    await pg.click("#g-fetch-btn");
    await pg.waitForFunction(() => /Real data/.test(document.getElementById("g-fetch-status").textContent));
    assert.equal(await pg.$eval("#g-frost", (e) => e.value), "2026-09-28");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no freeze in the median year: the box stays empty", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port); // lows of 62 every day: no 28F freeze in any year
    await pg.evaluate(() => localStorage.clear());
    await setup(pg, { plant: "2026-05-01", end: "2026-08-01" });
    await fetchWeather(pg);
    assert.equal(await pg.$eval("#g-frost", (e) => e.value), "");
    assert.equal(await txt(pg, "#r-frost-verdict"), "Add freeze date");
  } finally { await browser.close(); srv.close(); }
});

test("on a phone the answer comes above the setup after a fetch", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { width: 390 });
    await pg.evaluate(() => localStorage.clear());
    const order = () => pg.evaluate(() => {
      const r = document.getElementById("gdu-results").getBoundingClientRect().top;
      const s = document.getElementById("g-plant").getBoundingClientRect().top;
      return r < s ? "answer-first" : "setup-first";
    });
    assert.equal(await order(), "setup-first");
    await setup(pg, { plant: "2026-05-01", end: "2026-08-01" });
    await fetchWeather(pg);
    assert.equal(await order(), "answer-first");
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(sw <= 390, "no sideways scroll: " + sw);
    // Changing the planting date drops the fetched weather: setup comes back first.
    await type(pg, "#g-plant", "2026-05-03");
    assert.equal(await order(), "setup-first");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("desktop keeps the two-column layout after a fetch", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { width: 1280 });
    await setup(pg, { plant: "2026-05-01", end: "2026-08-01" });
    await fetchWeather(pg);
    const left = await pg.evaluate(() => document.getElementById("g-plant").getBoundingClientRect().left);
    const resLeft = await pg.evaluate(() => document.getElementById("gdu-results").getBoundingClientRect().left);
    assert.ok(left < resLeft, "setup stays on the left");
  } finally { await browser.close(); srv.close(); }
});
