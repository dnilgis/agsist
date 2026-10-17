/* /rain-print panel fixes (2026-10-17, rp-panel2 ease-trust and money):
 *   1. one distance for one station: the status line says what the print says;
 *   2. a failed town lookup (504) can be drawn again with Draw, no reload;
 *   4. phone: "Make yours, free" under the prices goes to the town box;
 *   5. the checkout dialog names the proof email above Pay;
 *   6. each card's Christmas date says it needs the proof OK'd the day it comes;
 *   7. the gift address note: their address at checkout too;
 *  10. tap targets, badge size, the Up close name, the preview strip on focus.
 * Browser cases need Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-fix3.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y, upto) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > upto) return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}

/* Ames: the town at 42.0308,-93.6319, the station AMES 2 NNW about 2 mi off.
   geo: a function returning the status for the next town lookup (200 = found). */
async function mocks(ctx, st) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const upto = "2026-10-09";
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const req = r.request(), u = new URL(req.url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") {
      st.geoAsks++;
      if (st.geoFail > 0) { st.geoFail--; return r.fulfill({ status: 504, body: "gateway" }); }
      return r.fulfill({ json: { results: [{ name: "Ames", latitude: 42.0308, longitude: -93.6319, admin1: "Iowa", country_code: "US" }] } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [{ name: "AMES 2 NNW", sids: ["130200 2"], ll: [-93.6431, 42.0597], valid_daterange: [["1950-01-01", upto]], state: "IA" }] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y, upto).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: "AMES 2 NNW", state: "IA", ll: [-93.6431, 42.0597] }, data: series(+String(sdate).slice(0, 4), upto) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!extname(p) && existsSync(p + ".html")) p += ".html";
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, opts = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width || 1280, height: opts.height || 900 }, serviceWorkers: "block", hasTouch: !!opts.phone, isMobile: !!opts.phone });
    await ctx.clock.setFixedTime(new Date(opts.time || "2026-10-17T17:00:00Z"));
    const st = { geoAsks: 0, geoFail: opts.geoFail || 0 };
    await mocks(ctx, st);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, st);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const idle = (page) => page.waitForFunction(() => !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });

test("2: a town lookup that failed (504) draws on the next Draw, no reload", { skip }, async () => {
  await withPage(async (page, base, errors, st) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    st.geoFail = 99;
    await page.fill("#rp-place", "Ames, IA");
    await page.selectOption("#rp-year", "2025");
    await page.click("#rp-go");
    await page.waitForFunction(() => /error 504/.test(document.getElementById("rp-status").textContent), null, { timeout: 30000 });
    await idle(page);
    // a second Draw while the lookup is still down: asked again, and the line says so
    let asks = st.geoAsks;
    await page.click("#rp-go");
    await page.waitForFunction(() => /Asked again just now \(\d+ tries\)\. The town lookup didn\u2019t answer \(error 504\)/.test(document.getElementById("rp-status").textContent), null, { timeout: 30000 });
    assert.ok(st.geoAsks > asks, "Draw asked the lookup again");
    st.geoFail = 0;
    await idle(page);
    const before = st.geoAsks;
    assert.equal(await page.$eval("#rp-go", (b) => b.disabled), false, "Draw is on after the failure");
    await page.click("#rp-go");
    await drawn(page);
    assert.ok(st.geoAsks > before, "the lookup was asked again");
    assert.match(await page.textContent("#rp-status"), /^Drawn from the records at the co-op station \u201cAMES 2 NNW\u201d, \d\.\d mi from Ames\.$/);
    assert.deepEqual(errors, []);
  });
});

test("1: one distance for one station: the status line gives the print's distance, the station's name in quotes", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Ames, IA");
    await page.selectOption("#rp-year", "2025");
    await page.click("#rp-go");
    await drawn(page);
    await page.waitForFunction(() => /^Drawn from/.test(document.getElementById("rp-status").textContent), null, { timeout: 30000 });
    const status = await page.textContent("#rp-status"), source = await page.textContent("#rp-source");
    const svg = await page.$eval("#rp-art svg", (el) => el.textContent);
    const mi = /, (\d+\.\d) mi from Ames/.exec(status);
    assert.ok(mi, "the status line names one distance: " + status);
    assert.ok(source.includes(mi[1] + " mi from Ames"), "the source line says the same: " + source);
    assert.ok(svg.includes(mi[1] + " mi from Ames"), "and so does the print");
    assert.ok(!/\b2 mi NNW\b/.test(status), "no second distance made from the station's name: " + status);
    assert.match(status, /\u201cAMES 2 NNW\u201d/, "the name is quoted as NOAA has it");
    assert.deepEqual(errors, []);
  });
});

test("1: stationSaid in the code: every status line that names the drawn station uses it", () => {
  assert.ok(!/setStatus\([^;]*stationName\(META\.name\)/.test(S), "no status line builds the station from its raw name");
  assert.match(S, /'Drawn from the records at ' \+ stationSaid\(META, true\)/);
});
