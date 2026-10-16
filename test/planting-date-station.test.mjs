/* /planting-date, the Oct 16 rebuild: answer first, then the reader's own numbers.
 *
 *   1. Static answer: the deadline line matches data/rma-planting-dates.json for every
 *      WI and MN county, no em dashes anywhere in the page or its script.
 *   2. With a ZIP: nearest NOAA normals station (fixture file), frost odds sorted the
 *      right way, heat units to the median and the 1-in-10 early frost worked by hand,
 *      no maturity call words; county RMA dates; soil 3-day mean, 5-day trend, verdict
 *      with a fixed clock.
 *   3. Honest empty states: no station file yet, a station too far away, no county.
 *   4. Season line by month, and phone width with no sideways scroll.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/planting-date-station.test.mjs
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
const FIX = readFileSync(join(ROOT, "test/fixtures/planting-normals/wi.json"), "utf8");

// ---------------------------------------------------------------- static checks (no browser)

test("no em dashes in the page or its script", () => {
  for (const f of ["planting-date.html", "components/planting-date.js"]) {
    const s = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!s.includes("—") && !/&mdash;/.test(s), f + " has an em dash");
  }
});

test("the static deadline line matches the RMA file for every WI and MN county", () => {
  const html = readFileSync(join(ROOT, "planting-date.html"), "utf8");
  const rma = JSON.parse(readFileSync(join(ROOT, "data/rma-planting-dates.json"), "utf8"));
  const corn = new Set(), beans = new Set();
  for (const c of Object.values(rma.counties)) if (c.state === "WI" || c.state === "MN") { corn.add(c.corn); beans.add(c.soybeans); }
  assert.deepEqual([...corn].sort(), ["May 25", "May 31"]);
  assert.deepEqual([...beans].sort(), ["Jun 10", "Jun 15"]);
  assert.match(html, /corn <b>May 25 or 31<\/b>, soybeans <b>Jun 10 or 15<\/b> \(USDA RMA, 2026\)/);
  assert.equal(rma.crop_year, 2026);
});

test("the answer comes before any input, and the local block starts hidden", () => {
  const html = readFileSync(join(ROOT, "planting-date.html"), "utf8");
  const main = html.slice(html.indexOf('<main'));
  assert.ok(main.indexOf("Apr 25 to May 10") < main.indexOf('id="pd-zip"'), "answer above the ZIP box");
  assert.match(main, /<section id="pd-local"[^>]*hidden>/);
  assert.match(html, /<script src="\/components\/planting-date\.js\?v=\d+" defer><\/script>/);
  assert.ok(Buffer.byteLength(html) < 60000, "page HTML stays small: " + Buffer.byteLength(html));
});

test("the station data files, once written, pass the fetcher's own rules", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("python3", [join(ROOT, "scripts/fetch_planting_normals.py"), "--check"], { encoding: "utf8" });
  assert.match(out, /0 problem\(s\)/);
});

// ---------------------------------------------------------------- browser

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/planting-date") p = "/planting-date.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// Open-Meteo answer: 52 F every hour up to "now", then each forecast day 2 F warmer (or cooler).
function meteo(nowIso, step) {
  const now = new Date(nowIso + ":00Z");
  const start = new Date(now.getTime() - 3 * 864e5); start.setUTCHours(0);
  const time = [], soil = [];
  for (let t = start.getTime(); t < now.getTime() + 6 * 864e5; t += 36e5) {
    const iso = new Date(t).toISOString().slice(0, 16);
    time.push(iso);
    const dayAhead = Math.floor((Date.parse(iso.slice(0, 10)) - Date.parse(nowIso.slice(0, 10))) / 864e5);
    soil.push(iso <= nowIso ? 52 : 52 + step * dayAhead);
  }
  return { current: { time: nowIso, temperature_2m: 61.3 }, hourly: { time, soil_temperature_6cm: soil } };
}

async function open(browser, port, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: o.width || 1280, height: 900 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  if (o.clock) await pg.clock.setFixedTime(new Date(o.clock));
  await pg.route("**/*", (r) => {
    const u = r.request().url();
    if (u.includes("api.open-meteo.com")) return r.fulfill({ contentType: "application/json", body: JSON.stringify(meteo(o.now || "2027-05-05T12:00", o.step ?? 2)) });
    if (u.includes("nominatim.openstreetmap.org")) return r.fulfill({ contentType: "application/json", body: JSON.stringify([o.place || { lat: "45.31", lon: "-91.65", display_name: "Chetek, Barron County, Wisconsin, 54728, United States", address: { county: "Barron County", state: "Wisconsin", "ISO3166-2-lvl4": "US-WI" } }]) });
    if (u.endsWith("/data/planting/wi.json")) return o.noStations ? r.fulfill({ status: 404, body: "" }) : r.fulfill({ contentType: "application/json", body: FIX });
    if (u.endsWith("/data/planting/mn.json")) return r.fulfill({ status: 404, body: "" });
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/planting-date`);
  await pg.waitForFunction(() => document.getElementById("cmp-grid").textContent.trim() !== "");
  return { pg, errors, ctx };
}
async function loadZip(pg, zip = "54728") {
  await pg.fill("#pd-zip", zip);
  await pg.dispatchEvent("#pd-zip", "input");
  await pg.click("#pd-fetch-btn");
  await pg.waitForFunction(() => /Loaded/.test(document.getElementById("pd-status").textContent));
}
const txt = (pg, sel) => pg.$eval(sel, (e) => (e.innerText || e.textContent).replace(/\s+/g, " ").trim());

test("ZIP in May: station frost odds, heat units by hand, county dates, soil trend", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { clock: "2027-05-05T17:00:00Z" });
    assert.match(await txt(pg, "#pd-season"), /^Planting season/);
    assert.equal(await pg.$eval("#pd-local", (e) => e.hidden), true, "hidden before a location");
    await loadZip(pg);
    assert.equal(await pg.$eval("#pd-local", (e) => e.hidden), false);
    const stn = await txt(pg, "#pd-stn");
    // Fixture station is about 14 miles from the geocoded point (45.31, -91.65 to 45.40, -91.85).
    assert.match(stn, /Frost odds at Testville Airport/);
    assert.match(stn, /USW00099991, 1[0-9] mi from you, 860 ft/);
    assert.match(stn, /Last spring 32°F Apr 24 May 8 May 22/);
    assert.match(stn, /First fall 32°F Sep 18 Sep 28 Oct 8/);
    assert.match(stn, /Last spring 28°F Apr 10 Apr 22 May 4/);
    assert.match(stn, /read 2027-02-02/);
    const gdu = await pg.$$eval("#pd-stn-gdu tbody tr", (trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent.trim())));
    const row = (d) => gdu.find((r) => r[0] === d);
    // Fixture GDD a day: Apr 5, May 15, Jun-Aug 20, Sep 10.
    // May 1 to Sep 28 (median): 31x15 + 92x20 + 27x10 = 465 + 1840 + 270 = 2,575.
    assert.deepEqual(row("May 1"), ["May 1", "2,575", "2,475"]); // to Sep 18: 465 + 1840 + 170 = 2,475
    // Apr 20 adds 11 April days at 5: 2,575 + 55 = 2,630; 2,475 + 55 = 2,530.
    assert.deepEqual(row("Apr 20"), ["Apr 20", "2,630", "2,530"]);
    // Jun 1 sits between the 5-day points May 31 and Jun 5 (15 + 4x20 = 95 over 5 days), so the
    // file's linear step reads May 1 to Jun 1 as 465 + 4 = 469: 2,575 - 469 = 2,106 (exact 2,110).
    assert.deepEqual(row("Jun 1"), ["Jun 1", "2,106", "2,006"]);
    const g = await txt(pg, "#pd-stn-gdu");
    assert.match(g, /A 108-day hybrid is rated about 2,626 GDUs to black layer/);
    assert.doesNotMatch(g, /short|will not mature|does not reach|won't make/i);
    // County final planting dates for Barron County, WI, from the RMA file.
    const rma = await txt(pg, "#pd-rma");
    assert.match(rma, /Corn May 31 Soybeans Jun 10/i);
    assert.match(rma, /Barron County, WI\. USDA RMA Revenue Protection final planting dates, 2026 crop year; RMA sets the 2027 dates in its own file/);
    // Soil: 72 hourly values of 52 F, then forecast days at 54, 56, 58, 60, 62.
    assert.equal(await txt(pg, "#st-2in"), "52.0°F");
    const tr = await txt(pg, "#st-trend");
    assert.match(tr, /Next 5 days \(model, daily mean\): 54° May 6 56° May 7 58° May 8 60° May 9 62° May 10 warming/i);
    assert.match(await txt(pg, "#st-verdict-wrap"), /Acceptable/);
    assert.match(await txt(pg, "#st-asof"), /May 5, 12 pm local time/);
    // A planned date adds its own row.
    await pg.click("#pd-local"); // no-op focus
    await pg.$eval("details.pd-more", (d) => (d.open = true));
    await pg.fill("#pd-plant", "2027-05-15");
    await pg.dispatchEvent("#pd-plant", "change");
    const mine = await pg.$$eval("#pd-stn-gdu tbody tr.mine", (trs) => trs.map((tr) => tr.cells[0].textContent));
    assert.deepEqual(mine, ["May 15 (yours)"]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("a cooling soil forecast says the warming-trend part of the rule is not met", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { clock: "2027-05-05T17:00:00Z", step: -1 });
    await loadZip(pg);
    assert.match(await txt(pg, "#st-trend"), /cooling/i);
    assert.match(await txt(pg, "#st-note"), /forecast cools/);
  } finally { await browser.close(); srv.close(); }
});

test("October: season line looks to next spring and names the station", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { clock: "2026-10-16T17:00:00Z", now: "2026-10-16T12:00" });
    assert.match(await txt(pg, "#pd-season"), /^Planting is done for 2026\./);
    await loadZip(pg);
    assert.match(await txt(pg, "#pd-season"), /Next spring at Testville Airport: the last 32°F night comes after May 8 in half of years and after May 22 1 year in 10/);
    assert.match(await txt(pg, "#st-verdict-wrap"), /Out of the planting window/);
  } finally { await browser.close(); srv.close(); }
});

test("no station file yet: a clear empty state, zone averages stand in", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { noStations: true });
    await loadZip(pg);
    assert.match(await txt(pg, "#pd-stn"), /load after the first NOAA read/);
    assert.equal(await pg.$eval("#pd-stn-gdu", (e) => e.hidden), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("far from any WI or MN station: says so, no numbers borrowed", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const place = { lat: "41.5", lon: "-93.6", display_name: "Des Moines, Polk County, Iowa", address: { county: "Polk County", state: "Iowa", "ISO3166-2-lvl4": "US-IA" } };
    const { pg } = await open(browser, port, { place });
    await loadZip(pg, "50309");
    const s = await txt(pg, "#pd-stn");
    assert.match(s, /No NOAA normals station in Wisconsin or Minnesota within 75 miles/);
    assert.doesNotMatch(s, /Median/);
    // Polk County, IA is in the RMA file, so the county block still answers.
    assert.match(await txt(pg, "#pd-rma"), /Polk County, IA/);
  } finally { await browser.close(); srv.close(); }
});

test("county missing from the lookup: says so and gives the WI/MN range", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const place = { lat: "45.31", lon: "-91.65", display_name: "Somewhere, Wisconsin", address: { state: "Wisconsin" } };
    const { pg } = await open(browser, port, { place });
    await loadZip(pg, "Somewhere");
    assert.match(await txt(pg, "#pd-rma"), /did not come back.*May 25 or May 31 for corn and Jun 10 or Jun 15 for soybeans/);
  } finally { await browser.close(); srv.close(); }
});

test("phone, 390 wide: no sideways scroll with everything loaded, both crops", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg } = await open(browser, port, { width: 390, clock: "2027-05-05T17:00:00Z" });
    await loadZip(pg);
    for (const pill of ["#pill-corn", "#pill-bean"]) {
      await pg.click(pill);
      await pg.$$eval("details", (ds) => ds.forEach((d) => (d.open = true)));
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= 390, pill + " scrollWidth " + sw);
    }
  } finally { await browser.close(); srv.close(); }
});
