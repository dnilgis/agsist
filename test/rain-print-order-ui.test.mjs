/* /rain-print in a real browser: the order path a buyer walks, with NOAA
 * (data.rcc-acis.org), the town lookup and the subs worker answered here
 * from made-up data, and window.open recorded instead of opening Stripe.
 *
 * Checks the bugs the 2026-10-14 panel found:
 *   - rain-print?d=RPS-<id> and ?d=GIFT-RPS-<id> open the design through the
 *     short link (they said "damaged or cut short");
 *   - an Order tap with example words left explains it under that button,
 *     with "Clear the example and order" and "Edit the words" (it scrolled
 *     the buyer 2,500 px up);
 *   - the checkout "tap here" note lands under the button that was tapped;
 *   - "Order this print" in the proof orders the framed or print it showed;
 *   - labels count to 13 letters and say what was cut, never silently, and
 *     run full width on a phone.
 *
 * Needs Playwright and Chromium. Where they are missing (CI without a
 * browser), the test is skipped and says so.
 *
 *   node --test test/rain-print-order-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_ORDER_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const ctxVm = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctxVm.window = ctxVm;
vm.runInNewContext(readFileSync(ROOT + "components/rain-print.js", "utf8"), ctxVm);
const RP = ctxVm.RainPrint;
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));

// a long design: past Stripe's 200 characters, so checkout carries RPS-<id>
const LONG = { place: "Chetek, WI", station: "471667 2", year: 2025, style: "r1", cmp: "normal", name: "The Olson Family Farm",
  dedication: "For Grandpa Erling, sixty harvests on the home place. Love, all of us",
  markers: [{ date: "2025-05-08", label: "Planted beans" }, { date: "2025-07-04", label: "Hay all in" }, { date: "2025-10-24", label: "Harvest done" }] };
const LONG_CODE = RP.encodeCode(LONG);
const GIFT_CODE = RP.encodeCode({ ...LONG, year: 2026, markers: [{ date: "2026-05-08", label: "Planted beans" }] });
const SHORT = { K7Q2M: LONG_CODE, G1FT9: GIFT_CODE };

// ---------- made-up NOAA data, the same shape ACIS sends ----------
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
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", "2026-10-09"]], state: "WI" };

async function mocks(ctx) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      const m = /^\/rp-short\/([0-9A-Z]+)$/.exec(u.pathname);
      if (m) return SHORT[m[1]] ? r.fulfill({ status: 200, headers: h, json: { ok: true, code: SHORT[m[1]] } }) : r.fulfill({ status: 404, headers: h, json: { ok: false } });
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (u.host === "geocoding-api.open-meteo.com") return r.fulfill({ json: { results: [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }] } });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { const p = JSON.parse(u.searchParams.get("params")); sdate = p.sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = 1995; y <= 2025; y++) data = data.concat(series(y)); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sdate).slice(0, 4)) } });
    }
    return r.abort();
  });
}

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function withPage(fn, { width = 390, theme = "light" } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: "block", colorScheme: theme });
    await mocks(ctx);
    await ctx.addInitScript(() => { window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; }; });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
const onScreen = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight; });
const settle = (page) => page.waitForTimeout(900);
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: SHOTS + "/" + name + ".png" }); } };
const q = (o) => new URLSearchParams(o).toString();
const EX = { place: "Chetek, WI", year: "2025", station: "471667 2", style: "r1", name: "The Johnson Farm", dedication: "For Dad, his 40th crop. Love, Kate",
  m1: "2025-05-08 Planted", m2: "2025-07-12 Hail", m3: "2025-10-24 Harvest done" };

test("rain-print?d=RPS-<id> opens the design; GIFT-RPS-<id> keeps the gift flag", { skip }, async () => {
  assert.ok(LONG_CODE.length > 200 && RP.checkoutRef(LONG_CODE, false, "HTTPS://AGSIST.COM/R?K7Q2M") === "RPS-K7Q2M");
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?d=RPS-K7Q2M");
    await drawn(page);
    await settle(page);
    await shot(page, "rps-open-390-" + theme);
    assert.equal(await page.inputValue("#rp-name"), LONG.name);
    assert.equal(await page.inputValue("#rp-m1l"), "Planted beans");
    assert.equal(await page.isHidden("#rp-link-note"), true, "no 'damaged or cut short' note");
    await page.goto(base + "/rain-print.html?d=GIFT-RPS-G1FT9");
    await drawn(page);
    assert.equal(await page.inputValue("#rp-name"), LONG.name);
    assert.match(page.url(), /[?&]gift=1(&|$)/, "the January gift flag stays on the design");
    await page.goto(base + "/rain-print.html?d=RPS-ZZZZZ");
    await page.waitForFunction(() => !document.getElementById("rp-link-note").hidden, null, { timeout: 15000 });
    assert.match(await page.textContent("#rp-link-note"), /RPS-ZZZZZ isn’t one the site knows/);
    assert.deepEqual(errors, []);
  }, { theme });
});

test("Order with example words left: the reason under that button, Clear the example and order goes on to checkout", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q({ ...EX, m1: "2025-06-22 Our own day" }));
    await drawn(page);
    const btn = '.rp-buy-btn[data-choice="print12x18"]';
    await page.locator(btn).scrollIntoViewIfNeeded();
    await settle(page);
    const y0 = await page.evaluate(() => scrollY);
    await page.click(btn);
    await settle(page);
    const y1 = await page.evaluate(() => scrollY);
    assert.ok(Math.abs(y1 - y0) < 400, `the page stays by the button (moved ${y1 - y0} px)`);
    assert.equal(await page.$eval(btn, (b) => b.nextElementSibling && b.nextElementSibling.id), "rp-buy-note", "the note sits right under the tapped button");
    assert.ok(await onScreen(page, "#rp-ex-go"), "the choice is on screen");
    const note = await page.textContent("#rp-buy-note");
    assert.match(note, /the name, the line under it, 2 of the dates/);
    assert.match(note, /your own words stay/);
    assert.deepEqual(await page.evaluate(() => window.__opened), [], "nothing ordered with example words on it");
    await shot(page, "bounce-inline-390-" + theme);
    await page.click("#rp-ex-go");
    await settle(page);
    assert.equal(await page.inputValue("#rp-name"), "", "the example name is cleared");
    assert.equal(await page.inputValue("#rp-m1l"), "Our own day", "the buyer's own date stays");
    assert.equal(await page.inputValue("#rp-m2l"), "");
    const opened = await page.evaluate(() => window.__opened);
    assert.equal(opened.length, 1, "checkout opens on the same tap");
    assert.ok(opened[0].startsWith(J.payment_links.print12x18 + "?client_reference_id="), opened[0]);
    // the "tap here" fallback: under the button that was tapped, on screen
    assert.equal(await page.$eval(btn, (b) => b.nextElementSibling.id), "rp-buy-note");
    assert.ok(await onScreen(page, "#rp-buy-note a"), "the tap-here link is on screen");
    await shot(page, "checkout-note-390-" + theme);
    assert.deepEqual(errors, []);
  }, { theme });
});

test("Edit the words takes the buyer to section 2", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q(EX));
    await drawn(page);
    const btn = '.rp-buy-btn[data-choice="digital"]';
    await page.locator(btn).scrollIntoViewIfNeeded();
    await page.click(btn);
    await settle(page);
    await page.click("#rp-ex-edit");
    await settle(page);
    assert.ok(await onScreen(page, "#rp-ex-note"), "the example note in section 2 is on screen");
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
  });
});

test("the checkout note goes under the framed card's button too, never left under another card", { skip }, async () => {
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson" }));
    await drawn(page);
    for (const id of ["digital", "framed12x18"]) {
      const btn = `.rp-buy-btn[data-choice="${id}"]`;
      await page.locator(btn).scrollIntoViewIfNeeded();
      await page.click(btn);
      await settle(page);
      assert.equal(await page.$eval(btn, (b) => b.nextElementSibling.id), "rp-buy-note", id);
      assert.ok(await onScreen(page, "#rp-buy-note a"), id + ": tap-here link on screen");
    }
    assert.equal((await page.evaluate(() => window.__opened)).length, 2);
  });
});

test("Order from the proof: framed or print only as picked there, straight to that order", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson", m1: "2025-06-22 Married" }));
    await drawn(page);
    await page.click("#rp-zoom");
    await page.waitForSelector("#rp-proof[open]");
    assert.equal(await page.textContent("#rp-proof-order"), "Order it framed");
    await page.click('[data-pview="print"]');
    assert.equal(await page.textContent("#rp-proof-order"), "Order the print");
    await page.click("#rp-proof-order");
    await settle(page);
    assert.equal(await page.$eval("#rp-proof", (d) => d.open), false, "the dialog closes");
    assert.equal(await page.getAttribute("#rp-wall", "data-view"), "print", "the preview keeps Print only");
    const opened = await page.evaluate(() => window.__opened);
    assert.equal(opened.length, 1);
    assert.ok(opened[0].startsWith(J.payment_links.print12x18 + "?"), "the print, not the framed: " + opened[0]);
    assert.equal(await page.$eval('.rp-buy-btn[data-choice="print12x18"]', (b) => b.nextElementSibling.id), "rp-buy-note");
    assert.ok(await onScreen(page, "#rp-buy-note a"));
    await shot(page, "proof-order-390-" + theme);
  }, { theme });
});

test("labels: a counter to 13 letters, a paste past it says what was cut, a linked cut label is flagged on the proof, full width on a phone", { skip }, async () => {
  for (const theme of ["light", "dark"]) await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + q({ place: "Chetek, WI", year: "2025", station: "471667 2", name: "Olson", m1: "2025-06-22 Our wedding day", m2: "2025-10-24 Harvest done" }));
    await drawn(page);
    assert.equal(await page.inputValue("#rp-m1l"), "Our wedding d");
    assert.match(await page.textContent("#rp-m1l-n"), /Only 13 letters fit, so “Our wedding day” is cut to “Our wedding d”/);
    assert.equal(await page.textContent("#rp-m2l-n"), "12 of 13 letters");
    // phone: each label box runs the full width, so "Harvest done" isn't clipped
    const w = await page.$eval("#rp-m2l", (el) => [el.getBoundingClientRect().width, el.scrollWidth, el.clientWidth, document.getElementById("rp-name").getBoundingClientRect().width]);
    assert.ok(Math.abs(w[0] - w[3]) < 2, `label box is as wide as the name box on a phone: ${w[0]} vs ${w[3]}`);
    assert.ok(w[1] <= w[2], "no text clipped in the box");
    await page.locator("#rp-m1l").scrollIntoViewIfNeeded();
    await shot(page, "labels-390-" + theme);
    // the proof flags it
    await page.click("#rp-zoom");
    await page.waitForSelector("#rp-proof[open]");
    assert.match(await page.textContent("#rp-proof-sum"), /“Our wedding d” \(cut off: only 13 letters fit, the link had “Our wedding day”\)/);
    await page.click("#rp-proof-close");
    // typing: the box stops at 13, and the counter says that's the most
    await page.fill("#rp-m3l", "");
    await page.type("#rp-m3l", "Sold the cows today");
    assert.equal(await page.inputValue("#rp-m3l"), "Sold the cows");
    assert.equal(await page.textContent("#rp-m3l-n"), "13 of 13 letters. That’s the most that fits.");
    // a paste past the limit is cut by the box, and the counter names it
    await page.fill("#rp-m3l", "");
    await page.focus("#rp-m3l");
    await page.evaluate(() => {
      const el = document.getElementById("rp-m3l"), dt = new DataTransfer();
      dt.setData("text/plain", "Dad's last crop");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      el.value = "Dad's last crop".slice(0, 13); el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(50);
    assert.match(await page.textContent("#rp-m3l-n"), /“Dad's last crop” is cut to “Dad's last cr”/);
    // changing the label clears it
    await page.fill("#rp-m3l", "Last crop");
    assert.equal(await page.textContent("#rp-m3l-n"), "9 of 13 letters");
    assert.deepEqual(errors, []);
  }, { theme });
});
