/* /gdu-calculator in a real browser, the 2026-10-15 head-to-head fixes.
 *
 *   1. A crop that already passed black layer gets the day it crossed the
 *      target, not the end date, and the freeze is compared with that day.
 *      Case from the review: 84/62 F every day from May 1 to Oct 14 is 23 GDU
 *      a day; a 108-day hybrid needs 2,650, reached on day 116 = Aug 24, which
 *      is 42 days before an Oct 5 freeze. The page used to say "Oct 14" and
 *      "9 days short".
 *
 * Weather and the geocoder are mocked so the arithmetic is exact.
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/gdu-calculator-h2h.test.mjs
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
async function open(browser, port, { weather = () => [84, 62], state = "Iowa", width = 1280 } = {}) {
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

test("a crop past black layer shows the day it crossed, and the freeze verdict uses that day", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await setup(pg, { plant: "2026-05-01", end: "2026-10-14", frost: "2026-10-05" });
    await fetchWeather(pg);
    assert.match(await txt(pg, "#r-mat-date"), /^August 24, 2026$/);
    assert.match(await txt(pg, "#r-mat-lbl"), /reached/i);
    assert.match(await txt(pg, "#r-frost-verdict"), /42 days/);
    assert.doesNotMatch(await txt(pg, "#r-frost-verdict"), /short/);
    assert.match(await txt(pg, "#r-mat-note"), /August 24/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a freeze before the crossing day is still called short", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    await setup(pg, { plant: "2026-05-01", end: "2026-10-14", frost: "2026-08-20" });
    await fetchWeather(pg);
    assert.match(await txt(pg, "#r-mat-date"), /^August 24, 2026$/);
    assert.match(await txt(pg, "#r-frost-verdict"), /4 days short/);
  } finally { await browser.close(); srv.close(); }
});

test("missing archive days do not count toward the crossing day", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Ten blank days in June: those days add nothing, so the crossing moves 10 days later.
    const { pg } = await open(browser, port, { weather: (d) => (d >= "2026-06-01" && d <= "2026-06-10" ? null : [84, 62]) });
    await setup(pg, { plant: "2026-05-01", end: "2026-10-14", frost: "2026-10-05" });
    await fetchWeather(pg);
    assert.match(await txt(pg, "#r-mat-date"), /^September 3, 2026$/);
  } finally { await browser.close(); srv.close(); }
});

test("example mode past black layer gives the crossing day, not the end date", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    // 82/58 = 20 GDU a day; 2,650 / 20 = 132.5, so the 133rd day after planting: Sep 11.
    await setup(pg, { plant: "2026-05-01", end: "2026-10-15", frost: "2026-10-01" });
    assert.match(await txt(pg, "#r-mat-date"), /^September 11, 2026$/);
    assert.match(await txt(pg, "#r-frost-verdict"), /20 days/);
  } finally { await browser.close(); srv.close(); }
});

test("a typed GDU total past the target does not invent a date", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port);
    await setup(pg, { plant: "2026-05-01", end: "2026-10-14", frost: "2026-10-05" });
    await pg.click("details.gdu-manual > summary");
    await pg.selectOption("#g-method", "cumulative");
    await type(pg, "#g-cumgdu", 3000);
    assert.equal(await txt(pg, "#r-mat-date"), "-");
    assert.doesNotMatch(await txt(pg, "#r-frost-verdict"), /short/);
  } finally { await browser.close(); srv.close(); }
});
