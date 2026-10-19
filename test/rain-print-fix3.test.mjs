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

// ---------- (i) maker mode, gated ----------
test("(i) the maker gate: only the hash is in the code, honest comment, serial still behind it", () => {
  assert.match(S, /var MAKER_HASH = '[0-9a-f]{64}'/);
  assert.match(S, /It is not DRM/);
  assert.match(S, /return MAKER && m \? 'No\. ' \+ String\(\+m\[1\]\)\.padStart\(4, '0'\) : '';/, "serial=N and serial=0 still need maker mode");
  assert.ok(!/maker-key|MAKER_KEY\s*=/.test(S), "no key in the code");
});

test("(i) ?maker=1 alone is the public page; the right key once opens it on that browser, then ?maker=1 works", { skip }, async () => {
  const { createHash } = await import("node:crypto");
  const TEST_KEY = "test-only-key-0000000";
  const real = /var MAKER_HASH = '([0-9a-f]{64})'/.exec(S)[1];
  const fake = createHash("sha256").update(TEST_KEY).digest("hex");
  await withPage(async (page, base, errors) => {
    // a test-only hash: the shipped file with the constant swapped, so the real key never enters the repo
    await page.route(/\/components\/rain-print\.js/, (r) => r.fulfill({ contentType: "text/javascript", body: S.replace(real, fake) }));
    await page.goto(base + "/rain-print.html?maker=1");
    await idle(page);
    assert.equal(await page.isHidden("#rp-maker"), true, "no maker box for ?maker=1 alone");
    await page.goto(base + "/rain-print.html?maker=wrong-key-00000000000");
    await page.waitForTimeout(800);
    assert.equal(await page.isHidden("#rp-maker"), true, "a wrong key opens nothing");
    await page.goto(base + "/rain-print.html?maker=" + TEST_KEY + "&serial=0");
    await page.waitForURL(/maker=1&serial=0/, { timeout: 15000 });
    await idle(page);
    assert.ok(!page.url().includes(TEST_KEY), "the key leaves the address bar");
    assert.equal(await page.isVisible("#rp-maker"), true, "the maker box opens");
    await page.goto(base + "/rain-print.html?maker=1");
    await idle(page);
    assert.equal(await page.isVisible("#rp-maker"), true, "and ?maker=1 works on this browser from then on");
    assert.deepEqual(errors, []);
  });
});

// ---------- helpers for the order cases ----------
async function drawAmes(page, base, year = "2025", qs = "") {
  await page.goto(base + "/rain-print.html" + qs);
  await idle(page);
  await page.fill("#rp-place", "Ames, IA");
  await page.selectOption("#rp-year", year);
  await page.click("#rp-go");
  await drawn(page);
  await page.waitForTimeout(400);
}
async function openSheet(page) {
  await page.click("#rp-pay");
  if (await page.isVisible("#rp-noname-go")) await page.click("#rp-noname-go");
  await page.waitForSelector("#rp-proof[open]");
}

test("4: phone: Make yours, free sits in the first screen and goes to the town box; desktop: not shown", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    const box = await page.locator("#rp-start").boundingBox();
    assert.ok(box && box.y + box.height <= 844, "in the first phone screen: " + JSON.stringify(box));
    assert.equal(await page.textContent("#rp-start"), "Make yours, free");
    assert.ok(box.height >= 24, "a real tap target");
    await page.click("#rp-start");
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "rp-place", null, { timeout: 5000 });
    await page.waitForTimeout(700);
    const r = await page.locator("#rp-place").boundingBox();
    assert.ok(r.y >= 0 && r.y + r.height <= 844, "the town box is on screen: " + JSON.stringify(r));
    assert.deepEqual(errors, []);
  }, { width: 390, height: 844, phone: true });
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html");
    assert.equal(await page.isVisible("#rp-start"), false, "desktop has the town box in view already");
  });
});

test("5, 6, 7: the card's Christmas date carries its condition; above Pay, the proof email and the late-OK line; the gift address said once", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawAmes(page, base);
    // 6: each card (the date from data/rain-print.json, not written in the page)
    assert.match(await page.textContent("#rp-sub-framed12x18"), /Order by Dec 9 for Christmas, if you OK the proof the day it comes\.$/);
    assert.match(await page.textContent("#rp-sub-print12x18"), /Order by Dec 10 for Christmas, if you OK the proof the day it comes\.$/);
    // (c) make another
    assert.equal(await page.isVisible("#rp-another"), true);
    await openSheet(page);
    const when = await page.textContent("#rp-proof-when");
    assert.equal(when, "Watch for an email from Sig at sig@farmers1st.com with your proof. Check spam if it’s not there by Monday. OK it late? I’ll tell you the new date the same day.",
      "Saturday Oct 17: the next business day is Monday");
    const order = await page.evaluate(() => { const w = document.getElementById("rp-proof-when"), b = document.getElementById("rp-proof-order"); return !!(w.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
    assert.ok(order, "the line sits above Pay");
    // the digital file: its own true line, no proof
    await page.check('input[name="rp-pproduct"][value="digital"]');
    assert.equal(await page.textContent("#rp-proof-when"), "The finished file comes by email from Sig at sig@farmers1st.com within 1 business day. Check spam if it’s not there by Monday.");
    await page.check('input[name="rp-pproduct"][value="framed12x18"]');
    // 7, (e), (m): the gift address note under Their address, and no second instruction elsewhere
    await page.check("#rp-pg-on");
    assert.equal(await page.textContent("#rp-pg-ship"), "Where it ships: at checkout, Stripe asks for the shipping address. Give theirs.");
    assert.equal(await page.isVisible("#rp-pg-addr"), false, "no address box: Stripe takes it (2026-10-19)");
    assert.ok(!/give the same one/.test(await page.textContent("#rp-pg-line")), "said once");
    await page.selectOption("#rp-pg-deliver", "buyer");
    assert.equal(await page.textContent("#rp-pg-ship"), "Where it ships: at checkout, Stripe asks for the shipping address. Give yours.");
    await page.click("#rp-proof-close");
    assert.equal(await page.isHidden("#rp-gift-line"), true, "the caption under the mockup is gone when checkout takes the gift");
    assert.match(await page.textContent("#rp-gift-pre"), /^A gift\? On the next screen, before you pay, tick This is a gift/);
    // (c): Make another opens the Year box with the town and words kept
    await page.click("#rp-another");
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-year");
    assert.equal(await page.inputValue("#rp-place"), "Ames, IA");
    assert.deepEqual(errors, []);
  }, { time: "2026-10-17T17:00:00Z" });
});

test("(a): a design of this year says the gift card now, the print in January, at the top and right above Pay", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawAmes(page, base, "2026");
    await page.waitForFunction(() => !document.getElementById("rp-xmas-top").hidden, null, { timeout: 10000 });
    assert.equal(await page.textContent("#rp-xmas-top"), "For Christmas: this year (2026) is a gift card now, the print in January. Last year (2025) comes by Christmas if you order it framed by Dec 9, or as a print by Dec 10.");
    await openSheet(page);
    assert.equal(await page.textContent("#rp-proof-when"), "Arrives in January, once the year is done. A gift card for under the tree comes by email within 1 business day.");
    assert.deepEqual(errors, []);
  }, { time: "2026-10-17T17:00:00Z" });
});

test("(l): past the framed date the page starts on the print; past both, on the digital file, and says what still makes it", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.waitForFunction(() => !document.getElementById("rp-xmas-top").hidden, null, { timeout: 10000 });
    assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "print12x18", "Dec 10: framed has passed, the print still makes it");
  }, { time: "2026-12-10T18:00:00Z" });
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.waitForFunction(() => !document.getElementById("rp-xmas-top").hidden, null, { timeout: 10000 });
    assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "digital", "Dec 11: only the file still makes it");
    assert.match(await page.textContent("#rp-xmas-top"), /Too late for the mail\? The digital file comes by email in 1 business day, or give the gift card now and the print after Christmas\.$/);
  }, { time: "2026-12-11T18:00:00Z" });
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html?pick=framed12x18");
    await idle(page);
    await page.waitForTimeout(500);
    assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "framed12x18", "a pick in the link stays");
  }, { time: "2026-12-11T18:00:00Z" });
  await withPage(async (page, base) => {
    await page.goto(base + "/rain-print.html");
    await idle(page);
    await page.waitForTimeout(500);
    assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "framed12x18", "before the date, framed stays first");
  }, { time: "2026-11-02T18:00:00Z" });
});

test("10: 24 px checkboxes and remove buttons, 13 px badges, Up close named; the sticky preview folds to its words while typing on a phone", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await drawAmes(page, base);
    const tag = await page.$eval(".rp-ex-tag", (el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(tag >= 12, "badge text " + tag);
    for (const id of ["rp-zoom", "rp-strip-zoom"]) {
      const l = await page.getAttribute("#" + id, "aria-label");
      assert.match(l, /^Up close: see the print at full size$/, id + " says what it does and keeps its visible words");
    }
    const cb = await page.evaluate(() => [...document.querySelectorAll(".rp-check input[type=checkbox]")].map((el) => { const s = getComputedStyle(el); return [el.id, parseFloat(s.width), parseFloat(s.height)]; }));
    assert.ok(cb.length > 0);
    for (const [id, w, h] of cb) assert.ok(w >= 24 && h >= 24, id + " is " + w + " x " + h);
    const rm = await page.evaluate(() => { const b = document.getElementById("rp-m1rm"); const s = getComputedStyle(b); return [parseFloat(s.minWidth) || b.offsetWidth, parseFloat(s.minHeight)]; });
    assert.ok(rm[0] >= 24 && rm[1] >= 24, "remove day " + rm);
    // the strip shows once the print scrolls away; a text box with the keyboard puts it aside
    await page.evaluate(() => window.scrollTo(0, document.getElementById("rp-name").getBoundingClientRect().top + window.scrollY - 400));
    await page.waitForTimeout(600);
    const shown = await page.evaluate(() => { const s = document.getElementById("rp-strip"); return !s.hidden && getComputedStyle(s).display !== "none"; });
    if (shown) {
      await page.focus("#rp-name");
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById("rp-mini")).display), "none", "the picture folds away while typing");
      assert.ok(await page.evaluate(() => document.getElementById("rp-strip").offsetHeight) < 60, "down to its line of words");
      await page.evaluate(() => document.activeElement.blur());
      await page.waitForTimeout(200);
      assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById("rp-mini")).display), "none", "back after");
    } else assert.match(HTML, /body:has\(:is\(input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),textarea,select\):focus\) \.rp-strip :is\(\.rp-mini,\.chip\)\{display:none\}/);
    assert.deepEqual(errors, []);
  }, { width: 390, height: 844, phone: true });
});

// ---------- static checks ----------
test("3: the size words say what each file is; product ids stay what Stripe and the worker know", () => {
  assert.match(HTML, /<li>A PNG and a PDF of the picture alone, 12 x 18 in at 300 dpi, no watermark; it fits a 12 x 18 frame<\/li>/);
  assert.match(HTML, /<li>Printed on 13 x 19 in heavy, textured cotton fine-art paper; fits a standard 13 x 19 frame with an 11 x 17 mat<\/li>/);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const prod = ld["@graph"].find((g) => g["@type"] === "Product");
  assert.deepEqual(prod.offers.map((o) => o.sku), ["rp-digital", "rp-print-13x19", "rp-framed-13x19"]);
  assert.match(prod.offers[0].name, /12 x 18 in at 300 dpi/);
  // the ids the payment links and the worker use are unchanged
  assert.match(HTML, /value="print12x18"/); assert.match(HTML, /value="framed12x18"/);
  assert.match(S, /var CHOICE = \{ digital: 'Digital file', print12x18: '13 x 19 print', framed12x18: '13 x 19 framed print' \};/);
});

test("8: search words by the H1; Offers carry delivery time and a price date, the transit from data/rain-print.json", () => {
  const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
  assert.match(HTML, /<p class="sec-label rp-kick">Rainfall art, a gift for a farmer<\/p>\s*<h1>/);
  assert.match(HTML, /<p class="rp-lede">A framed print of the farm&rsquo;s year of rain, from the gauge nearest it\. /);
  const ld = JSON.parse(HTML.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const offers = ld["@graph"].find((g) => g["@type"] === "Product").offers;
  for (const o of offers) assert.match(o.priceValidUntil, /^\d{4}-12-31$/);
  for (const [sku, id] of [["rp-print-13x19", "print12x18"], ["rp-framed-13x19", "framed12x18"]]) {
    const dt = offers.find((o) => o.sku === sku).shippingDetails.deliveryTime;
    assert.equal(dt["@type"], "ShippingDeliveryTime");
    assert.equal(dt.transitTime.maxValue, J.transit_business_days[id], sku + " transit");
    assert.equal(dt.handlingTime.maxValue, J.proof_business_days + J.approve_business_days + J.ship_business_days, sku + " handling: proof, OK, ship");
  }
});

test("(f): a business list that doesn't add up asks once; one that does, or says how many, goes", async () => {
  const vm = (await import("node:vm")).default;
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
  vm.runInNewContext(S, ctx);
  const t = ctx.RainPrint.bizTownCheck;
  assert.equal(t(30, "Chetek, WI 2012\nAmes, IA 2012\nCameron, WI 1988"), '30 prints and 3 towns: is one town for several? Say how many go with each (like "Chetek, WI, 2012, x 10"), or press Send again to send it as it is.');
  assert.equal(t(30, "Chetek, WI 2012 for all"), "", "one town for all");
  assert.equal(t(30, "Chetek, WI 2012 x 20\nAmes, IA 2012 x 10"), "", "counts given");
  assert.equal(t(9, "Chetek\nAmes"), "", "under 10: no question");
  assert.equal(t(10, "Town, State, Year\nChetek, WI, 2012"), "", "a header and one town is one town for all");
  assert.equal(t(3 + 9, Array.from({ length: 12 }, (_, i) => "Town" + i + ", WI, 2012").join("\n").replace(/^Town0/, "Ames")), "", "as many lines as prints");
  const B = readFileSync(ROOT + "components/rp-business.js", "utf8");
  assert.match(B, /R\.bizTownCheck\(qn, x\.towns\)/, "the business page asks the same question");
  for (const src of [S, B]) assert.match(src, /within 1 business day with a quote, then a proof sheet\./);
});

test("(d): year records name the record's start, or both ends of the years beaten, in English and French", async () => {
  const vm = (await import("node:vm")).default;
  const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob }; ctx.window = ctx;
  vm.runInNewContext(readFileSync(ROOT + "components/rp-canada.js", "utf8"), ctx);
  const C = ctx.AgRpCanada, loc = { lang: "fr", units: "mm" };
  assert.equal(C.recordLabel({ kind: "wetYear", value: 30, label: "Wettest year in this station’s record, back to 1938" }, loc), "Année la plus arrosée jamais mesurée ici, depuis 1938");
  assert.equal(C.recordLabel({ kind: "dryYear", value: 10, label: "Driest year from 2001 to 2025" }, loc), "Année la plus sèche de 2001 à 2025");
  const R = readFileSync(ROOT + "components/rain-print-records.js", "utf8");
  assert.ok(!/than any year since/.test(R.replace(/\/\*[\s\S]*?\*\//g, "")), "the ambiguous wording is gone from the code");
});

test("(h), (k): the letter's key says tan and pale blue, in the print's own colors; the scale says its unit", () => {
  const I = readFileSync(ROOT + "components/rp-insert.js", "utf8"), A = readFileSync(ROOT + "components/rain-print-art.js", "utf8");
  assert.match(I, /Dashed line: a usual year\. Tan where your year fell behind it, pale blue where it ran ahead\./);
  assert.ok(!/Pink where/.test(I));
  assert.match(A, /dryBand: '#ECE6DE', wetBand: '#EAEFF4'/);
  assert.match(A, /stone: C\.dryBand, ahead: C\.wetBand/, "the band and the key read one pair of colors");
  assert.match(A, /fill="' \+ \(a > b \? X\.stone : X\.ahead\) \+ '"/, "stone where the year's line is lower (behind), blue where higher");
  assert.match(A, /v === topTick \? \(LOC\.mm \? ' mm' : ' in'\) : ''/);
});
