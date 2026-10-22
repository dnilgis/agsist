/* /rain-print: a NOAA ask that fails is not a station with nothing to give
 * (2026-10-19, Rain Print audit and adversary, Chetek 2025, cmp normal, records
 * on, maker, serial 3). The normal answering 500, or slower than FETCH_MS
 * (15 s), read "This station has no NOAA normal" and the maker's print file,
 * the digital file and the order all went out without the usual-year line.
 * Now: the page says the line didn't load and to press Draw again; ordering,
 * the maker files and the letter stay shut and say why, until a Draw brings it
 * in. A station with no normal (ACIS's {"error"} reply) prints as before, and
 * an answer at 6 s is simply waited for.
 * Needs Playwright and Chromium; skipped where they are missing.
 *
 *   node --test test/rain-print-loadfail.test.mjs
 */
import { makerFlag } from "./fixtures/rp-maker.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob, Intl, Date };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-17") return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    const sn = (i < 60 || i > 330) && p !== "0.00" && p !== "T" ? (p * 10).toFixed(1) : "0.0";
    return [d, p, String(t), sn, String(t + 9), String(t - 9)];
  });
}
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-17"]], state: "WI" };

// mode.normal: "ok" | "500" | "error" (ACIS: no normal) | a delay in ms; mode.por: "ok" | "500"
async function mocks(ctx, mode) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  const SHORT = {}; let nid = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (r) => {
    const u = new URL(r.request().url());
    if (u.host === "buy.stripe.com") return r.fulfill({ status: 200, contentType: "text/html", body: "<p>stripe</p>" });
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m) return SHORT[m[1]] ? r.fulfill({ headers: h, json: { ok: true, code: SHORT[m[1]] } }) : r.fulfill({ status: 404, headers: h, json: { ok: false } });
      if (u.pathname === "/rp-short") { const b = JSON.parse(r.request().postData() || "{}"); const id = "K7Q" + "ABCDEFGHJK"[nid++ % 10] + "M"; SHORT[id] = b.code; return r.fulfill({ headers: h, json: { ok: true, id } }); }
      if (u.pathname === "/form") return r.fulfill({ headers: h, json: { ok: true } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", admin2: "Barron", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sdate = p.sdate; normal = /normal/.test(u.searchParams.get("params")); }
      if (normal) {
        if (mode.normal === "500") return r.fulfill({ status: 500, body: "x" });
        if (mode.normal === "error") return r.fulfill({ json: { error: "no normals" } });
        if (typeof mode.normal === "number") await new Promise((z) => setTimeout(z, mode.normal));
        return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08", "0.2"]) } }).catch(() => {});
      }
      if (sdate === "por") {
        if (mode.por === "500") return r.fulfill({ status: 500, body: "x" });
        let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y));
        return r.fulfill({ json: { data } });
      }
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
async function withPage(mode, fn) {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
    await makerFlag(ctx);
    await ctx.clock.setFixedTime(new Date("2027-01-11T17:00:00Z"));
    await mocks(ctx, mode);
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + "/rain-print.html?d=" + RP.encodeCode(DESIGN) + "&maker=1&serial=3");
    await drawn(page);
    await fn(page, errors);
  } finally { await browser.close(); srv.close(); }
}
const DESIGN = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", normals: true, records: true, name: "Olson" };
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 40000 });
const BTN = { print: '#rp-maker button[data-size="12x18"][data-fmt="png"]', digital: '#rp-maker button[data-size="digital"]', letter: '#rp-maker button[data-size="insert"]' };
// -> the file name saved, or "" when nothing was saved within ms
async function save(page, which, ms = 8000) {
  const dl = page.waitForEvent("download", { timeout: ms }).catch(() => null);
  await page.click(BTN[which]);
  const g = await dl;
  return g ? g.suggestedFilename() : "";
}
const line = (page) => page.evaluate(() => /usual year/i.test(document.getElementById("rp-art").innerHTML));
const source = (page) => page.textContent("#rp-source");

async function refused(page, errors) {
  assert.equal(await line(page), false, "no usual-year line on the print");
  const src = await source(page);
  assert.match(src, /The usual-year line didn’t load\. Press Draw again\./);
  assert.ok(!/no NOAA normal/.test(src), "a failure is not called a station with no normal: " + src);
  assert.ok(!/A usual year here means NOAA/.test(src), "no sentence about a normal that isn't there");
  assert.match(await page.textContent("#rp-status"), /The usual-year line didn’t load\. Press Draw again\./);
  // ordering is off and says why
  assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), true, "Check it and pay is off");
  assert.match(await page.textContent("#rp-buy-why"), /Ordering is off: the usual-year line didn’t load\. Press Draw again\./);
  // the maker's files and the letter: nothing saved, the reason in the maker box
  for (const w of ["print", "digital", "letter"]) {
    assert.equal(await save(page, w, 3000), "", w + " file saved without the line");
    assert.match(await page.textContent("#rp-maker-msg"), /No file saved: The usual-year line didn’t load\. Press Draw again, then make the file\./, w);
  }
  assert.deepEqual(errors, []);
}

test("the normal answers 500: no order, no maker file, no letter, and the page says it didn't load; Draw again brings it in", { skip, timeout: 120000 }, async () => {
  const mode = { normal: "500" };
  await withPage(mode, async (page, errors) => {
    await page.waitForTimeout(1500);
    await refused(page, errors);
    // NOAA answers again: Draw brings the line in and everything opens
    mode.normal = "ok";
    await page.click("#rp-go");
    await drawn(page);
    await page.waitForFunction(() => /usual year/i.test(document.getElementById("rp-art").innerHTML), null, { timeout: 20000 });
    assert.ok(!/didn’t load/.test(await source(page)));
    assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), false);
    assert.match(await save(page, "print", 30000), /-12x18-300dpi-no-0003\.png$/);
    assert.deepEqual(errors, []);
  });
});

test("the normal answers after more than 15 s (timed out): same as a failure", { skip, timeout: 120000 }, async () => {
  await withPage({ normal: 17000 }, async (page, errors) => {
    // the timeout lands at FETCH_MS (15 s); wait for the draw to finish with it
    await page.waitForFunction(() => /didn’t load\. Press Draw again/.test(document.getElementById("rp-source").textContent), null, { timeout: 40000 });
    await refused(page, errors);
  });
});

test("a station with no NOAA normal (ACIS error reply): worded and saved as before", { skip, timeout: 120000 }, async () => {
  await withPage({ normal: "error" }, async (page, errors) => {
    await page.waitForTimeout(1500);
    const src = await source(page);
    assert.match(src, /This station has no NOAA normal, so there’s no comparison line\./);
    assert.ok(!/didn’t load\. Press Draw again/.test(src));
    assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), false, "ordering stays open");
    assert.match(await save(page, "print", 30000), /-12x18-300dpi-no-0003\.png$/, "the print file saves");
    assert.equal(await page.textContent("#rp-maker-msg"), "");
    assert.deepEqual(errors, []);
  });
});

test("the normal answers at 6 s: waited for, then the line is on the file", { skip, timeout: 120000 }, async () => {
  await withPage({ normal: 6000 }, async (page, errors) => {
    await page.waitForFunction(() => /usual year/i.test(document.getElementById("rp-art").innerHTML), null, { timeout: 20000 });
    assert.ok(!/didn’t load|no NOAA normal/.test(await source(page)));
    assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), false);
    assert.match(await save(page, "print", 30000), /-12x18-300dpi-no-0003\.png$/);
    assert.deepEqual(errors, []);
  });
});

test("the station history answers 500 with records on: no file, and the maker box says why", { skip, timeout: 120000 }, async () => {
  await withPage({ normal: "ok", por: "500" }, async (page, errors) => {
    await page.waitForFunction(() => /history didn’t load/.test(document.getElementById("rp-source").textContent), null, { timeout: 30000 });
    assert.match(await source(page), /The station history didn’t load, so the year and month records are left off\. Press Draw again\./);
    assert.equal(await page.$eval("#rp-pay", (b) => b.disabled), true);
    assert.equal(await save(page, "print", 3000), "");
    assert.match(await page.textContent("#rp-maker-msg"), /No file saved: The station history didn’t load, so the remarkable days are missing\. Press Draw again/);
    assert.deepEqual(errors, []);
  });
});
