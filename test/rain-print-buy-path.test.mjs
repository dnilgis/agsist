/* /rain-print in a real browser: the buying-path fixes before real orders
 * (2026-10-15), with NOAA, the town lookup and the subs worker answered here
 * from made-up data.
 *
 *   - a phone that draws and swipes on past step 1 is never pulled back up to
 *     the town box (the pinned copy's focus nudge trapped it at step 1);
 *   - a design that names its station but carries no ?ll= (Sig's
 *     ?d=...&maker=1 view of a county-link order) draws the same town line the
 *     buyer saw, when the town lookup finds another town of that name or none;
 *   - the product picked survives leaving and coming back, and a reload: the
 *     price says $45 everywhere for Print.
 *
 * Needs Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-buy-path.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = process.env.RP_ROOT || fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > "2026-10-09") return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
const CHETEK = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };
const RATHBUN = { name: "RATHBUN DAM", sids: ["136910 2"], ll: [-92.90, 40.82], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "IA" };
const GEO = {
  chetek: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }],
  // another Rathbun, 300 km off (the lookup's first answer), and no Rathbun at all
  "rathbun-far": [{ name: "Rathbun", latitude: 43.0, longitude: -95.5, admin1: "Iowa", country_code: "US" }],
  "rathbun-none": [],
};

async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "buy.stripe.com") return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><p>stripe</p>" });
    if (u.host === "geocoding-api.open-meteo.com") {
      const name = (u.searchParams.get("name") || "").toLowerCase();
      return r.fulfill({ json: { results: name === "rathbun" ? GEO[opts.rathbun || "rathbun-far"] : GEO.chetek } });
    }
    if (u.host === "data.rcc-acis.org") {
      const stn = opts.stn || CHETEK;
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [stn] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y).map((x) => x.slice(0, 3))); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: stn.name, state: stn.state, ll: stn.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function withPage(fn, { width = 390, height = 844, ...opts } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", hasTouch: width < 900, isMobile: false });
    await ctx.clock.setFixedTime(new Date("2026-10-15T17:00:00Z"));
    await mocks(ctx, opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, ctx);
  } finally { await browser.close(); srv.close(); }
}
const idle = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-art").getAttribute("aria-busy"), null, { timeout: 30000 });
const gauge = (page) => page.evaluate(() => { const t = document.querySelector("#rp-art svg")?.textContent || ""; const m = /Weather station:[^]*?(mi from [A-Za-z ]+|near [A-Za-z ]+)/.exec(t); return m ? m[0].trim() : "NO ART: " + document.getElementById("rp-status").textContent; });

test("a phone that draws its town and swipes on past step 1 stays where it scrolled", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.waitForTimeout(400);
    // the keyboard is gone once the print is drawn (checked last, after the swipe)
    const held = await page.evaluate(() => document.activeElement && document.activeElement.id);
    // the worst case too: the town box still holds focus while the reader swipes on
    await page.evaluate(() => document.getElementById("rp-place").focus({ preventScroll: true }));
    for (const target of ["#rp-name", "#rp-m1mo", "#rp-pay"]) {
      const want = await page.$eval(target, (el) => Math.round(el.getBoundingClientRect().top + scrollY - innerHeight / 2));
      // a swipe: small steps from where the page is, so the pinned copy shows while the town box passes under it
      const from = await page.evaluate(() => scrollY);
      await page.mouse.move(195, 600);
      for (let y = from; y < want; y += 60) { await page.mouse.wheel(0, Math.min(60, want - y)); await page.waitForTimeout(30); }
      await page.waitForTimeout(700);
      const y = await page.evaluate(() => scrollY);
      assert.ok(Math.abs(y - want) < 40, `swiped to ${target} (${want}) and stayed, not pulled back up: scrollY ${y}`);
      assert.equal(await page.isVisible("#rp-strip"), true, "the pinned copy shows past the print");
    }
    assert.notEqual(held, "rp-place", "the town box let go of the keyboard after the draw");
    assert.deepEqual(errors, []);
  });
});

test("a county-link design with no ll= draws the town line the buyer saw, when the lookup finds another town of that name or none", { skip }, async () => {
  const code = RP.encodeCode({ place: "Rathbun, IA", station: "136910 2", year: 2025, style: "r1", cmp: "normal", name: "Test" });
  for (const rathbun of ["rathbun-far", "rathbun-none"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=" + code + "&maker=1");
    await idle(page);
    await page.waitForTimeout(500);
    const line = await gauge(page);
    assert.equal(line, "Weather station: Rathbun Dam, IA, near Rathbun", rathbun + ": " + line);
    // the gift card's preview reads the same way
    const pv = await page.evaluate((c) => window.RainPrint.previewArt(c, { idPrefix: "tt" }).then((r) => { const d = document.createElement("div"); d.innerHTML = r.svg; return d.textContent; }, (e) => "ERR " + e.message), code);
    assert.match(pv, /Weather station: Rathbun Dam, IA, near Rathbun/, rathbun + " preview");
    assert.ok(!/\d+ mi from Rathbun/.test(pv), rathbun + " preview has no distance from the other Rathbun");
    assert.deepEqual(errors, []);
  }, { width: 1280, height: 900, stn: RATHBUN, rathbun });
  // the lookup finding the right Rathbun still gives the distance
  GEO["rathbun-near"] = [{ name: "Rathbun", latitude: 40.80, longitude: -92.88, admin1: "Iowa", country_code: "US" }];
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?d=" + code + "&maker=1");
    await idle(page);
    assert.equal(await gauge(page), "Weather station: Rathbun Dam, IA, 1.7 mi from Rathbun");
  }, { width: 1280, height: 900, stn: RATHBUN, rathbun: "rathbun-near" });
});

test("Print picked, then away and back (and a reload): $45 everywhere, Print still picked", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.fill("#rp-place", "Chetek, WI");
    await page.selectOption("#rp-year", "2025");
    await page.press("#rp-place", "Enter");
    await page.waitForTimeout(300);
    await idle(page);
    await page.locator('.rp-prod[data-choice="print12x18"]').click();
    await page.waitForTimeout(200);
    const check = async (when) => {
      await idle(page);
      await page.waitForTimeout(400);
      assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "print12x18", when + ": Print picked");
      assert.match(await page.textContent("#rp-pay"), /\$45$/, when + ": the pay button");
      assert.match(await page.textContent("#rp-bar-what"), /\$45/, when + ": the phone bar");
      assert.ok(!/\$89/.test(await page.textContent("#rp-pay") + await page.textContent("#rp-bar-what")), when + ": no $89");
      assert.equal(await page.$eval("#rp-wall", (w) => w.getAttribute("data-view")), "print", when + ": the print at the top is the print alone");
    };
    await check("picked");
    await page.goto(base + "/about.html");
    await page.goBack();
    await check("back");
    await page.reload();
    await check("reload");
    // to the review sheet and Stripe, then Back
    await page.click("#rp-pay");
    await page.waitForTimeout(300);
    if (await page.isVisible("#rp-noname")) { await page.click("#rp-noname-go"); await page.waitForTimeout(300); }
    assert.equal(await page.$eval('input[name="rp-pproduct"]:checked', (r) => r.value), "print12x18", "the review sheet");
    await page.check("#rp-proof-ok");
    await Promise.all([page.waitForURL(/buy\.stripe\.com/), page.click("#rp-proof-order")]);
    await page.goBack();
    await check("back from Stripe");
    assert.deepEqual(errors, []);
  });
});
