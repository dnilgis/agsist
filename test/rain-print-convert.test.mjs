/* Rain Print, what turns a look into an order (2026-10-16): the date it
 * should arrive, by the pay button, from the same business-day sum as the
 * Christmas dates; the funnel events Analytics gets at each step, with no
 * words or town in them; the paid view's way to order another; the business
 * card's first discount price; the more-than-one question.
 *
 * Hand-worked dates (data/rain-print.json: proof 1, OK 1, ship 3, mail 5 for
 * a print and 6 framed, business days, Thanksgiving Nov 26 skipped):
 *   Fri Oct 16, framed: 11 business days -> Oct 19..23 (5), 26..30 (10), Mon Nov 2.
 *   Fri Oct 16, print: 10 -> Fri Oct 30.
 *   Sat Oct 17, framed: the clock starts Monday -> Mon Nov 2 as well.
 *   Fri Nov 20, print: Nov 23, 24, 25, (26 off), 27, 30, Dec 1, 2, 3, 4, 7 -> Mon Dec 7.
 *
 * Browser parts need Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-convert.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { checkout, stripePage } from "./fixtures/rp-checkout.mjs";

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

async function mocks(ctx, opts = {}) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "buy.stripe.com") return stripePage(r, opts.stripe);
    if (u.host === "agsist-subs.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      if (u.pathname === "/where") return opts.where ? r.fulfill({ headers: h, json: { ok: true, city: "Chetek", region_code: "WI" } }) : r.fulfill({ status: 503, headers: h, body: "x" });
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

async function withPage(fn, { width = 390, height = 844, theme = "light", where = false } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", colorScheme: theme });
    await ctx.clock.setFixedTime(new Date("2026-10-14T17:00:00Z"));
    const stripe = [];
    await mocks(ctx, { stripe, where });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, stripe);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
const events = (page) => page.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event").map((a) => [a[1], a[2] || {}]));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");

test("arriveBy: the hand-worked dates, and the same sum as the Christmas cutoffs", () => {
  assert.equal(RP.arriveBy(J, "framed12x18", "2026-10-16"), "2026-11-02");
  assert.equal(RP.arriveBy(J, "print12x18", "2026-10-16"), "2026-10-30");
  assert.equal(RP.arriveBy(J, "framed12x18", "2026-10-17"), "2026-11-02", "a Saturday order starts Monday");
  assert.equal(RP.arriveBy(J, "print12x18", "2026-11-20"), "2026-12-07", "Thanksgiving is not a business day");
  for (const id of ["print12x18", "framed12x18"]) {
    const cut = RP.christmasCutoff(J, id, 2026);
    assert.ok(RP.arriveBy(J, id, cut) <= "2026-12-24", id + ": ordered on the cutoff it arrives by Dec 24");
    assert.ok(RP.arriveBy(J, id, RP.addBizDays(cut, 1, J.holidays)) > "2026-12-24", id + ": a business day later it does not");
  }
  assert.equal(RP.arriveText(J, "framed12x18", "2026-10-16"), "Ordered today, it should arrive by about Monday, Nov 2.");
  assert.equal(RP.arriveText(J, "digital", "2026-10-16"), "", "the file says its own email day");
  assert.equal(RP.arriveBy({ ...J, transit_business_days: {} }, "framed12x18", "2026-10-16"), "", "a missing number: no date");
  assert.equal(RP.arriveBy(J, "framed12x18", "soon"), "");
});

test("the more-than-one question is on the page and in FAQPage, and the new words have no em dash", () => {
  // 2026-10-19 (board B): one tap after checkout for the next one
  assert.match(HTML, /<details><summary>Can I order more than one\?<\/summary><p>Yes\. Make one and pay for it\. When checkout brings you back here, tap Make another for someone else: the town, year and style stay and the words clear for the next one\. Or change the town or the year/);
  assert.match(HTML, /"name": "Can I order more than one\?"/);
  assert.ok(!/\u2014|&mdash;/.test(HTML), "no em dash on the page");
  const js = readFileSync(ROOT + "components/rain-print.js", "utf8");
  for (const s of ["Ordered today, it should arrive by about", "One for each of the kids", "Same words, another town or year"]) assert.ok(js.includes(s), s);
  assert.ok(!/\u2014/.test(js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no em dash in the engine's words");
});

test("a phone buyer sees the date it should arrive by the button, per product", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1" }));
    await drawn(page);
    await page.waitForTimeout(600);
    // the clock is Oct 14 (Wed): framed 11 business days -> Thu Oct 29; print 10 -> Wed Oct 28.
    // 2026-10-20 (Sig): in the Christmas window the line by the button is the order-by date, and the arrival date sits lower
    assert.equal(await page.textContent("#rp-arrive"), "Order by Dec 9 for Christmas delivery.");
    assert.equal(await page.textContent("#rp-arrive-est"), "Ordered today, it should arrive by about Thursday, Oct 29.");
    await page.fill("#rp-name", "Olson Home Place");
    await page.press("#rp-name", "Tab");
    await page.selectOption("#rp-m1mo", "07");
    await page.selectOption("#rp-m1dy", "04");
    await page.locator('.rp-prod[data-choice="print12x18"]').click();
    // the line updates after the click; read it once it has (twice in CI on Oct 22 it was read a moment early)
    await page.waitForFunction(() => document.getElementById("rp-arrive").textContent === "Order by Dec 10 for Christmas delivery.", null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.textContent("#rp-arrive"), "Order by Dec 10 for Christmas delivery.");
    assert.equal(await page.textContent("#rp-arrive-est"), "Ordered today, it should arrive by about Wednesday, Oct 28.");
    await page.locator('.rp-prod[data-choice="digital"]').click();
    assert.equal(await page.isVisible("#rp-arrive"), false, "the file has no mail date");
    assert.equal(await page.isVisible("#rp-arrive-est"), false);
    await page.locator('.rp-prod[data-choice="framed12x18"]').click();
    assert.equal(await page.isVisible("#rp-arrive"), true);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe", "the date line is in nobody's way: checkout still opens");
    assert.deepEqual(errors, []);
  });
});

test("every funnel step fires once, with no town, name or words in it", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    // checkout answers "no content", so the tab stays and its events can be read
    await page.route(/buy\.stripe\.com/, (r) => r.fulfill({ status: 204 }));
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1" }));
    await drawn(page);
    await page.waitForTimeout(600);
    await page.fill("#rp-name", "Olson Home Place");
    await page.press("#rp-name", "Tab");
    await page.fill("#rp-ded", "For Dad");
    await page.press("#rp-ded", "Tab");
    await page.fill("#rp-name", "Olson Home Place 2");
    await page.press("#rp-name", "Tab");
    await page.locator(".rp-presets button, #rp-presets button").first().click();
    await page.selectOption("#rp-m1mo", "07");
    await page.selectOption("#rp-m1dy", "04");
    await page.locator('.rp-prod[data-choice="print12x18"]').click();
    await page.locator("#rp-pay").scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.click("#rp-pay");
    await page.waitForTimeout(300);
    await page.check("#rp-proof-ok");
    await page.click("#rp-proof-order");
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.getElementById("rp-biz-d").open = true; });
    await page.waitForTimeout(200);
    const ev = await events(page);
    const names = ev.map((e) => e[0]).filter((n) => n.startsWith("rain_print_"));
    const count = (n) => names.filter((x) => x === n).length;
    assert.equal(count("rain_print_words"), 3, "name, line and day, once each: " + names);
    assert.deepEqual(ev.filter((e) => e[0] === "rain_print_words").map((e) => e[1].field).sort(), ["day", "line", "name"]);
    assert.equal(count("rain_print_pick"), 1);
    assert.equal(ev.find((e) => e[0] === "rain_print_pick")[1].choice, "print12x18");
    assert.equal(count("rain_print_step3"), 1, "the pay button came on screen: once");
    assert.equal(count("rain_print_proof"), 1);
    assert.equal(count("rain_print_buy"), 1);
    assert.equal(count("rain_print_business_open"), 1);
    assert.ok(names.indexOf("rain_print_step3") < names.indexOf("rain_print_proof") && names.indexOf("rain_print_proof") < names.indexOf("rain_print_buy"), names.join(" "));
    const all = JSON.stringify(ev);
    for (const s of ["Olson", "For Dad", "Chetek", "471667"]) assert.ok(!all.includes(s), "no " + s + " in any event");
    assert.deepEqual(errors, []);
  });
});

test("paid: a way to order another from the same words, and the business card names its first discount", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r1", name: "Olson" }));
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    await page.goto(base + "/rain-print.html?paid=framed12x18&s=cs_test_a1b2c3d4e5f6");
    await page.waitForFunction(() => !document.getElementById("rp-paid").hidden);
    await drawn(page);
    await page.waitForTimeout(600);
    const box = await page.innerText("#rp-paid");
    assert.match(box, /One for each of the kids, or for the home farm and the rented ground\? Each is its own order, with its own proof\.\s+Make another for someone else\s+Same words, another town or year or Make another$/);
    await page.click("#rp-paid-again");
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-year", "the year box, ready for the next one");
    assert.equal(await page.inputValue("#rp-name"), "Olson", "the words stay");
    const ev = await events(page);
    assert.equal(ev.filter((e) => e[0] === "rain_print_again").length, 1);
    assert.equal(ev.filter((e) => e[0] === "purchase").length, 1);
    const sub = await page.textContent("#rp-biz-sub");
    // the first tier under the card prices in data/rain-print.json (10 prints: $79 framed, $40 a print)
    const t = J.business_tiers.find((x) => x.framed12x18 !== J.framed12x18);
    assert.equal(sub, `Elevators, co-ops, ag lenders, seed dealers. From ${t.min} prints: $${t.framed12x18} framed, $${t.print12x18} a print, delivered.`);
    assert.deepEqual(errors, []);
  });
});

/* 2026-10-19 (board B): two gifts were two whole orders from scratch. Stripe Payment Links take one design a
   checkout, so after the paid return one tap starts the next: town, year, station and style kept, words cleared. */
test("paid: Make another for someone else keeps the town, year and style, clears the words, and checks out again", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: "2012", station: "471667 2", style: "r2", name: "Olson", dedication: "For Dad", m1: "2012-05-08Planted" }));
    await drawn(page);
    const r = await checkout(page, "framed12x18");
    assert.equal(r.stage, "stripe");
    await page.goto(base + "/rain-print.html?paid=framed12x18&s=cs_test_a1b2c3d4e5f6");
    await page.waitForFunction(() => !document.getElementById("rp-paid").hidden);
    await drawn(page);
    await page.waitForTimeout(600);
    assert.equal(await page.isVisible("#rp-paid-other"), true);
    await page.click("#rp-paid-other");
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.activeElement.id), "rp-name", "one tap, and the name box is ready");
    assert.equal(await page.inputValue("#rp-place"), "Chetek, WI");
    assert.equal(await page.inputValue("#rp-year"), "2012");
    assert.equal(await page.$eval('input[name="rp-style"]:checked', (x) => x.value), "r2", "the style stays");
    assert.equal(await page.inputValue("#rp-name"), "", "the name clears");
    assert.equal(await page.inputValue("#rp-ded"), "", "the line clears");
    assert.equal(await page.inputValue("#rp-m1l"), "", "the marked days clear");
    assert.ok(!(await page.$eval("#rp-art svg", (el) => el.textContent)).includes("Olson"), "the print up top lost the old name");
    await page.fill("#rp-name", "Hansen");
    await page.waitForTimeout(500);
    const ev = await events(page);
    assert.equal(ev.filter((e) => e[0] === "rain_print_another_person").length, 1);
    assert.ok(!JSON.stringify(ev).includes("Hansen"), "no words in any event");
    const r2 = await checkout(page, "framed12x18");
    assert.equal(r2.stage, "stripe", "the second checkout opens");
    assert.deepEqual(errors, []);
  });
});

test("the review sheet's gift box says how the second gift goes", () => {
  assert.match(HTML, /<p class="rp-note" id="rp-pg-two">Two gifts\? Pay for this one\. When checkout brings you back here, tap Make another for someone else: the same town, year and style, new words\.<\/p>/);
  assert.ok(HTML.indexOf('id="rp-pg-two"') > HTML.indexOf('id="rp-pg-box"') && HTML.indexOf('id="rp-pg-two"') < HTML.indexOf('id="rp-proof-go"'), "inside the gift box, shown once it is ticked");
});
