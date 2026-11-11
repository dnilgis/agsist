/* Rain Print, the order right after the picture (2026-11-11). Once the
 * reader's own print is drawn, the first thing under it is the order: the
 * price line (shipping included), the Christmas order-by date, one main
 * button (framed) and the print and the digital file as smaller buttons
 * beside it, then the gift link. The buttons go the one checkout way (the
 * review sheet, then the payment link with client_reference_id). A reader
 * outside the US and Canada sees the digital file only, and where prints ship.
 * Analytics gets rain_print_buy_shown once the block is on screen.
 *
 * The clock is held on Oct 15 of the year of the file's own Christmas
 * cutoffs, so every expected price and date is read from data/rain-print.json.
 *
 * Browser parts need Playwright and Chromium; skipped where they are missing.
 *   node --test test/rain-print-buy-after-draw.test.mjs
 *   RP_NOW_SHOTS=<dir> also saves the 390 and 1280 screenshots there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { stripePage, refOf } from "./fixtures/rp-checkout.mjs";
import { PLACES_ROUTE, isPlaces, placesKey, placesBody } from "./fixtures/places-mock.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const SHOTS = process.env.RP_NOW_SHOTS || null;
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const Y = +String(J.framed_christmas_cutoff).slice(0, 4);
const CLOCK = `${Y}-10-15T17:00:00Z`;
const DRAWN = Y - 1;
const LAST = `${Y}-10-09`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso) => MON[+iso.slice(5, 7) - 1] + " " + (+iso.slice(8, 10));
const usd = (n) => "$" + n;

// ---------- made-up NOAA data, the same shape ACIS sends ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function yearDays(y) { const a = []; for (let t = Date.UTC(y, 0, 1); new Date(t).getUTCFullYear() === y; t += 864e5) a.push(new Date(t).toISOString().slice(0, 10)); return a; }
function series(y) {
  const r = rng(7 + y);
  return yearDays(y).map((d, i) => {
    if (d > LAST) return [d, "M", "M", "M", "M", "M"];
    const u = r(), p = u < 0.12 ? (r() * r() * 2).toFixed(2) : u < 0.16 ? "T" : "0.00";
    const t = Math.round(44 + 32 * Math.sin((i - 105) / 365 * 2 * Math.PI));
    return [d, p, String(t), "0.0", String(t + 9), String(t - 9)];
  });
}
const STN = { name: "CHETEK", sids: ["471667 2"], ll: [-91.65, 45.32], valid_daterange: [["1950-01-01", LAST]], state: "WI" };

async function mocks(ctx, opts) {
  const h = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };
  await ctx.route(PLACES_ROUTE, (r) => {
    const u = new URL(r.request().url());
    if (u.host === "buy.stripe.com") return stripePage(r, opts.stripe);
    if (u.host === "agsist-api.dnilgis.workers.dev") {
      if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: h });
      // the reader's own area: outside the US the worker answers ok:false (workers/subs-worker.js /where)
      if (u.pathname === "/where") return opts.where === "away" ? r.fulfill({ headers: h, json: { ok: false } }) : r.fulfill({ status: 503, headers: h, body: "x" });
      if (u.pathname === "/rp-short") return r.fulfill({ status: 200, headers: h, json: { ok: true, id: "K7Q2M" } });
      return r.fulfill({ status: 503, headers: h, body: "x" });
    }
    if (isPlaces(u)) return r.fulfill({ json: placesBody(u, [{ name: "Chetek", latitude: 45.3141, longitude: -91.651, admin1: "Wisconsin", country_code: "US" }]) });
    if (u.host === "data.rcc-acis.org") {
      if (u.pathname === "/StnMeta") return r.fulfill({ json: { meta: [STN] } });
      let sdate = u.searchParams.get("sdate"), normal = false;
      if (u.searchParams.get("params")) { sdate = JSON.parse(u.searchParams.get("params")).sdate; normal = true; }
      if (normal) return r.fulfill({ json: { data: yearDays(+String(sdate).slice(0, 4)).map((d) => [d, "0.08"]) } });
      if (sdate === "por") { let data = []; for (let y = DRAWN - 30; y <= DRAWN; y++) data = data.concat(series(y)); return r.fulfill({ json: { data } }); }
      return r.fulfill({ json: { meta: { name: STN.name, state: "WI", ll: STN.ll }, data: series(+String(sdate).slice(0, 4)) } });
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
async function withPage(fn, { width = 390, height = 844, where = "", tz = "America/Chicago" } = {}) {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block", timezoneId: tz, hasTouch: width < 900 });
    await ctx.clock.setFixedTime(new Date(CLOCK));
    await ctx.addInitScript(() => { const s = new CSSStyleSheet(); s.replaceSync("html{scroll-behavior:auto!important}"); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; });
    const stripe = [];
    await mocks(ctx, { stripe, where });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await fn(page, `http://127.0.0.1:${port}`, errors, stripe);
  } finally { await browser.close(); srv.close(); }
}
const drawn = (page) => page.waitForFunction(() => document.querySelector("#rp-art svg") && !document.getElementById("rp-go").disabled && !document.getElementById("rp-now").hidden, null, { timeout: 30000 });
const events = (page) => page.evaluate(() => (window.dataLayer || []).filter((a) => a && a[0] === "event").map((a) => [a[1], a[2] || {}]));
const designUrl = (base) => base + "/rain-print.html?" + new URLSearchParams({ place: "Chetek, WI", year: String(DRAWN), station: "471667 2", style: "r1", name: "Olson Home Place" });
// the reader types the town and presses Draw (the bare page asks /where first)
async function drawTown(page) {
  await page.waitForFunction(() => !document.getElementById("rp-go").disabled, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  await page.fill("#rp-place", "Chetek, WI");
  await page.selectOption("#rp-year", String(DRAWN));
  await page.click("#rp-go");
  await drawn(page);
  await page.waitForTimeout(400);
}
const nowButtons = (page) => page.$$eval("#rp-now button[data-now]", (l) => l.filter((b) => b.getClientRects().length).map((b) => b.getAttribute("data-now")));

const JS = readFileSync(ROOT + "components/rain-print.js", "utf8");
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");

test("the block's words: no em dash, no I, no countdown, and prices come from the file", () => {
  const m = /<div class="rp-now" id="rp-now" hidden>[\s\S]*?\n        <\/div>\n/.exec(HTML);
  assert.ok(m, "the block is in the page, hidden until a print is drawn");
  const start = JS.indexOf("var NOW_SENT"), end = JS.indexOf("function setAway");
  assert.ok(start > 0 && end > start);
  const words = (m[0] + JS.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")).replace(/<[^>]+>/g, " ");
  assert.ok(!/—|&mdash;/.test(words), "no em dash");
  assert.ok(!/\bI\b|\bI['’]/.test(words.replace(/\bI\b(?=[A-Z])/g, "")), "no I in the new words");
  assert.ok(!/hurry|only \d+ left|left in stock|ends in|countdown|today only/i.test(words), "no urgency tricks");
  // the page HTML's own fallback numbers are the file's (the script rewrites them from the file)
  for (const id of ["framed12x18", "print12x18", "digital"]) assert.match(m[0], new RegExp(`data-price="${id}">\\$${J[id]}<`), id);
  assert.match(m[0], /shipping included/);
  assert.match(m[0], /Making it for someone\? Make it a gift/);
});

for (const [width, height] of [[390, 844], [1280, 900]]) {
  test(`${width} px: right after the draw, the order is the first thing under the print, with the file's prices and Christmas date`, { skip }, async () => {
    await withPage(async (page, base, errors) => {
      await page.goto(designUrl(base));
      await drawn(page);
      await page.waitForTimeout(500);
      const pos = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const wall = r("rp-wall"), now = r("rp-now");
        return { next: document.getElementById("rp-wall").nextElementSibling.id, gap: now.top - wall.bottom, nowTop: now.top, nowBottom: now.bottom, nowLeft: now.left, wallLeft: wall.left,
          layers: r("rp-layers").top, where: r("rp-where").top, design: r("rp-design").top, faq: r("rp-faq-h").top, wide: innerWidth >= 900 };
      });
      assert.equal(pos.next, "rp-now", "the block is the print's next sibling");
      assert.ok(pos.gap >= 0 && pos.gap < 32, "it sits right under the print: gap " + pos.gap);
      assert.ok(pos.nowBottom < pos.faq, "above the questions");
      if (!pos.wide) {
        assert.ok(pos.nowBottom <= pos.where && pos.nowBottom <= pos.layers && pos.nowBottom <= pos.design, "on a phone, before step 1, the layers and the words");
      } else {
        assert.ok(Math.abs(pos.nowLeft - pos.wallLeft) < 2, "on a wide screen, in the print's column, under it");
        assert.ok(pos.nowBottom <= height, "and on the first screen: bottom " + pos.nowBottom);
      }
      const t = await page.textContent("#rp-now-t");
      assert.equal(t, `Framed, ready to hang, ${usd(J.framed12x18)}, shipping included.`);
      assert.equal(await page.textContent("#rp-now-when"), `Order by ${short(J.framed_christmas_cutoff)} for Christmas delivery.`);
      assert.deepEqual(await nowButtons(page), ["framed12x18", "print12x18", "digital"], "framed first, then the print and the file");
      assert.ok(await page.$eval("#rp-now-go", (b) => b.classList.contains("btn-primary")), "framed is the one main button");
      const alts = await page.$$eval(".rp-now-alt", (l) => l.map((b) => b.textContent.trim()));
      assert.deepEqual(alts, [`Print ${usd(J.print12x18)}`, `Digital ${usd(J.digital)}`]);
      assert.equal(await page.isVisible("#rp-now-away"), false);
      assert.equal(await page.isVisible("#rp-now-gift"), true);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `rp-now-${width}.png`) }); }
      // the funnel: draw, then shown (once), then buy
      await page.waitForTimeout(300);
      const names = (await events(page)).map((e) => e[0]);
      assert.equal(names.filter((n) => n === "rain_print_buy_shown").length, 1, names.join(" "));
      assert.ok(names.indexOf("rain_print_draw") < names.indexOf("rain_print_buy_shown"), names.join(" "));
      assert.deepEqual(errors, []);
    }, { width, height });
  });
}

test("the main button goes the same checkout way: the review sheet, then the payment link with the design as client_reference_id", { skip }, async () => {
  await withPage(async (page, base, errors, stripe) => {
    await page.goto(designUrl(base));
    await drawn(page);
    await page.click("#rp-now-go");
    await page.waitForFunction(() => document.getElementById("rp-proof").open, null, { timeout: 5000 });
    assert.equal(await page.$eval('input[name="rp-pproduct"]:checked', (r) => r.value), "framed12x18");
    assert.equal(await page.textContent("#rp-proof-order"), `Pay ${usd(J.framed12x18)} at checkout`);
    await page.check("#rp-proof-ok");
    const went = page.waitForURL(/buy\.stripe\.com/, { timeout: 10000 }).then(() => true, () => false);
    await page.click("#rp-proof-order");
    assert.ok(await went, "the tab went to checkout");
    const u = page.url();
    assert.ok(u.startsWith(J.payment_links.framed12x18), "the framed payment link");
    assert.ok(refOf(u), "with client_reference_id");
    assert.deepEqual(errors, []);
  });
  // a smaller button picks its own product
  await withPage(async (page, base) => {
    await page.goto(designUrl(base));
    await drawn(page);
    await page.click('.rp-now-alt[data-now="print12x18"]');
    await page.waitForFunction(() => document.getElementById("rp-proof").open, null, { timeout: 5000 });
    assert.equal(await page.$eval('input[name="rp-pproduct"]:checked', (r) => r.value), "print12x18");
    assert.equal(await page.textContent("#rp-proof-order"), `Pay ${usd(J.print12x18)} at checkout`);
    const ev = await events(page);
    const buy = ev.filter((e) => e[0] === "rain_print_pick").map((e) => e[1]);
    assert.deepEqual(buy, [{ choice: "print12x18", where: "now" }]);
  });
});

test("the gift link turns on the gift: This is a gift ticked on the review sheet, its boxes open", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(designUrl(base));
    await drawn(page);
    assert.equal(await page.$eval("#rp-now-gift", (b) => b.getAttribute("aria-pressed")), "false");
    await page.click("#rp-now-gift");
    await page.waitForFunction(() => document.getElementById("rp-proof").open, null, { timeout: 5000 });
    assert.equal(await page.isChecked("#rp-pg-on"), true, "This is a gift is ticked");
    assert.equal(await page.isVisible("#rp-pg-box"), true, "the gift boxes are open");
    assert.equal(await page.isChecked("#ro-isgift"), true, "the order form says gift too");
    assert.equal(await page.$eval("#rp-now-gift", (b) => b.getAttribute("aria-pressed")), "true");
    // unticked on the sheet, the link says so too
    await page.uncheck("#rp-pg-on");
    assert.equal(await page.$eval("#rp-now-gift", (b) => b.getAttribute("aria-pressed")), "false");
    assert.deepEqual(errors, []);
  });
});

for (const width of [390, 1280]) {
  test(`${width} px: a reader outside the US and Canada sees the picture and the digital file only, and where prints ship`, { skip }, async () => {
    await withPage(async (page, base, errors) => {
      await page.goto(base + "/rain-print.html");
      await drawTown(page);
      assert.deepEqual(await nowButtons(page), ["digital"], "no print or framed button");
      assert.equal(await page.textContent("#rp-now-t"), `The digital file, 12 x 18 in, ${usd(J.digital)}, by email.`);
      const away = await page.textContent("#rp-now-away");
      assert.match(away, J.canada && J.canada.ships === true ? /^Prints and framed prints ship to addresses in the US and Canada\./ : /^Prints and framed prints ship to addresses in the US\./);
      assert.equal(await page.isVisible("#rp-now-when"), false, "no mail date for the file");
      assert.equal(await page.$eval('input[name="rp-product"]:checked', (r) => r.value), "digital", "step 3 starts on the file");
      if (width < 900) {
        await page.evaluate(() => window.scrollTo(0, document.getElementById("rp-design").getBoundingClientRect().top + scrollY));
        await page.waitForTimeout(400);
        if (await page.isVisible("#rp-bar")) assert.match(await page.textContent("#rp-bar-what"), new RegExp("^Digital file \\u00b7 \\" + usd(J.digital) + "$"));
      }
      // a wide screen: the hero sits above the print, so the block comes on screen once the reader scrolls to the print
      await page.evaluate(() => document.getElementById("rp-pv").scrollIntoView({ block: "start" }));
      await page.waitForTimeout(400);
      const shown = (await events(page)).filter((e) => e[0] === "rain_print_buy_shown").map((e) => e[1]);
      assert.deepEqual(shown, [{ choice: "digital", away: 1 }]);
      if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.evaluate(() => document.getElementById("rp-wall").scrollIntoView()); await page.screenshot({ path: join(SHOTS, `rp-now-away-${width}.png`) }); }
      assert.deepEqual(errors, []);
    }, { width, height: width < 900 ? 844 : 900, where: "away", tz: "Europe/Berlin" });
  });
}

test("a US time zone keeps every choice even when the area lookup says no (never the file alone by mistake)", { skip }, async () => {
  await withPage(async (page, base, errors) => {
    await page.goto(base + "/rain-print.html");
    await drawTown(page);
    assert.deepEqual(await nowButtons(page), ["framed12x18", "print12x18", "digital"]);
    assert.equal(await page.isVisible("#rp-now-away"), false);
    assert.deepEqual(errors, []);
  }, { where: "away", tz: "America/Chicago" });
});
