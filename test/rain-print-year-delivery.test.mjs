/* /rain-print: when it comes follows the year in the box, at once (2026-10-27).
 *
 * Page review, Oct 24 2026: with 2026 picked and the town lookup still loading,
 * the page said "2026 (ships January 2027)" beside "Ordered today, it should
 * arrive by about Monday, Nov 9" and the Christmas lines for a past year. The
 * delivery lines read "this year's gift" as giftMode() && canOrder(), and
 * canOrder() is false while a print draws or after a lookup fails, so for that
 * whole time the page talked about a past year's mail. Now every delivery line
 * reads the year in the box, loading and error states included.
 *
 * At 390 and 1280 px, with the clock at Oct 24 2026 (inside the Christmas
 * window): a 2026 design that is still looking up its town, the same after the
 * lookup fails, and a 2025 print switched to 2026 while 2026 is still drawing.
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-year-delivery.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
const SHOTS = process.env.RP_SHOTS || "";

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Intl, Date };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;

function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-23") return [d, "M", "M", "M", "M", "M"];
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, i % 9 === 0 ? "0.40" : "0.00", String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-23"]], state: "WI" };

/* geo: "hang" (the lookup never answers), "fail" (500), "ok". hang2026: ACIS never answers for 2026. */
async function mocks(ctx, mode) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") {
      if (mode.geo === "hang") return new Promise(() => {});
      if (mode.geo === "fail") return r.fulfill({ status: 500, body: "x" });
      return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", country_code: "US" }] } });
    }
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sdate = p.sdate; normal = /normal/.test(u.searchParams.get("params")); }
      if (mode.hang2026 && String(sdate).startsWith("2026")) return new Promise(() => {});
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08", "0.2"]) } }).catch(() => {});
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y)); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sdate || "2025").slice(0, 4)) } });
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
async function withPage(width, mode, design, fn) {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await ctx.clock.setFixedTime(new Date("2026-10-24T17:00:00Z"));
    await mocks(ctx, mode);
    const page = await ctx.newPage();
    page.setDefaultTimeout(40000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(design));
    await fn(page);
    assert.deepEqual(errors, [], "no script errors");
  } finally { await browser.close(); srv.close(); }
}
const D2026 = { place: "Chetek, WI", year: 2026, style: "r1", name: "Olson" };
const D2025 = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", name: "Olson" };

const lines = (page) => page.evaluate(() => {
  const g = (id) => { const el = document.getElementById(id); return el ? { t: el.textContent.trim(), hidden: el.hidden } : null; };
  return { arrive: g("rp-arrive"), est: g("rp-arrive-est"), top: g("rp-xmas-top"), why: g("rp-xmas-why"),
           print: g("rp-sub-print12x18"), framed: g("rp-sub-framed12x18"), digital: g("rp-sub-digital"),
           year: document.getElementById("rp-year").value,
           drawing: document.getElementById("rp-art").getAttribute("aria-busy") === "true" };
});

function assertThisYear(L, when) {
  assert.equal(L.year, "2026", when);
  assert.match(L.arrive.t, /^A 2026 print ships in January 2027/, `${when}: the line by Pay`);
  assert.ok(L.est.hidden || !L.est.t, `${when}: no arrival date for a past year (${L.est.t})`);
  for (const k of ["arrive", "est", "print", "framed"])
    assert.doesNotMatch(L[k].t, /arrive by about|Order by .* for Christmas/, `${when}: ${k} says "${L[k].t}"`);
  assert.match(L.print.t, /ships in January/, `${when}: print card`);
  assert.match(L.framed.t, /ships in January/, `${when}: framed card`);
  assert.match(L.digital.t, /January/, `${when}: file card`);
  if (!L.top.hidden) assert.match(L.top.t, /^For Christmas: this year \(2026\) is a gift card now, the print in January\./, `${when}: top line`);
  assert.ok(L.why.hidden, `${when}: the Christmas mail sum is not about this year's gift`);
}
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.locator("#rp-buy").scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: join(SHOTS, name + ".png") });
}

for (const width of [390, 1280]) {
  test(`${width}px: 2026 picked, the town lookup still loading`, { skip, timeout: 90000 }, async () => {
    await withPage(width, { geo: "hang" }, D2026, async (page) => {
      await page.waitForFunction(() => document.getElementById("rp-art").getAttribute("aria-busy") === "true");
      await page.waitForTimeout(500);
      const L = await lines(page);
      assert.ok(L.drawing, "still loading");
      assertThisYear(L, "loading");
      await shot(page, `loading-${width}`);
    });
  });

  test(`${width}px: 2026 picked, the town lookup failed`, { skip, timeout: 90000 }, async () => {
    await withPage(width, { geo: "fail" }, D2026, async (page) => {
      await page.waitForFunction(() => document.getElementById("rp-art").getAttribute("aria-busy") !== "true", null, { timeout: 40000 });
      await page.waitForTimeout(300);
      assertThisYear(await lines(page), "lookup failed");
      await shot(page, `failed-${width}`);
    });
  });

  test(`${width}px: a 2025 print switched to 2026 says January at once, while 2026 draws`, { skip, timeout: 90000 }, async () => {
    await withPage(width, { geo: "ok", hang2026: true }, D2025, async (page) => {
      await page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 40000 });
      const before = await lines(page);
      assert.doesNotMatch(before.arrive.t, /January 2027/, "a 2025 print does not wait for January");
      await page.selectOption("#rp-year", "2026");
      await page.waitForTimeout(300);
      const L = await lines(page);
      assertThisYear(L, "switched");
      await shot(page, `switched-${width}`);
    });
  });
}
