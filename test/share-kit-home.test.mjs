/* The home kit (share kit wave 1 step 3, Nov 7, 2026): components/home-kit.js, the "Today's markets" picture from the
 * homepage (index.html, the Save picture button in the Market Prices heading row).
 *
 *   node --test test/share-kit-home.test.mjs
 *
 * Frozen data: test/fixtures/share-kit-home/prices.json (the corn, soybean, wheat, cattle and hog quotes of the Nov 7,
 * 2026 price file: Nov 6 settles, read 1:46 am CT) and usda-calendar.ics (the November 2026 USDA rows); the clock is
 * the fixture's own (Sat Nov 7, 2026, 8:00 AM CT), never today. Every outside host and the live COT, WASDE and crop
 * progress files are refused; service workers are blocked.
 *   - the picture's rows are the page's own board: price, change and contract month as printed, and the page's own
 *     stamp for when the quote is from; a stale or missing quote is withheld and says so
 *   - this week's report comes from the page's calendar (WASDE and Crop Production, Tue Nov 10, 11:00 AM CT)
 *   - the reader's top bid shows only when the hero band shows it, current and timed
 *   - the QR code reads back to the homepage with the share tags (utm_campaign home-<date>)
 *   - without share-kit.js the page works and the button says it is unavailable
 *   - the button is in the HTML: nothing in its row moves while the page loads; no em dash anywhere in the kit
 * Browser parts need Playwright and Chromium; the QR part needs jsqr (JSQR_PATH or npm i jsqr). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const FIXD = join(ROOT, "test/fixtures/share-kit-home/");
const PRICES = JSON.parse(readFileSync(FIXD + "prices.json", "utf8"));
const ICS = readFileSync(FIXD + "usda-calendar.ics", "utf8");
const NOW = Date.parse(PRICES.now);
const DAY = new Date(NOW).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const LONG = new Date(NOW).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function jsqr() { for (const p of [process.env.JSQR_PATH, process.env.JSQR_PATH && join(process.env.JSQR_PATH, "node_modules/jsqr"), "jsqr"].filter(Boolean)) { try { return require(p); } catch (e) { /* next */ } } return null; }
const KIT = require(join(ROOT, "components/home-kit.js"));
const PX = require(join(ROOT, "components/price-local.js"));
const HAP = require(join(ROOT, "components/happening.js"));
const JS = read("components/home-kit.js");
const HOME = read("index.html");
const PIC = `https://agsist.com/?utm_source=share&utm_medium=picture&utm_campaign=home-${DAY}`;

/* a board row as the page hands it to the kit */
const quote = (k) => { const q = PRICES.quotes; return ({ corn: q["corn-nearby"], beans: q["beans-nearby"], wheat: q["wheat-nearby"] })[k] || q[k]; };
const row = (k, o = {}) => ({ key: k, name: k, month: "Dec '26", price: "$4.41 1/2", unit: "per bu", chg: "+1 1/2¢ (+0.3%)", dir: "up", q: quote(k), ...o });

/* ---------------------------------------------------------------- the model, in node */
test("the model: a current quote carries the page's stamp; a stale, old, unmarked-day or missing quote is withheld", () => {
  const b = { fetched: PRICES.fetched, rows: [row("corn"), row("beans", { mark: true }), row("wheat", { q: { ...quote("wheat"), stale: true } }),
    row("cattle", { price: "-" }), row("hogs", { q: { ...quote("hogs"), settle_date: "2026-11-02", close_date: "2026-11-02" } })] };
  const m = KIT.model(b, PX, NOW);
  assert.equal(m.rows[0].ok, true);
  assert.equal(m.rows[0].when, PX.stamp(quote("corn"), PRICES.fetched, new Date(NOW)));
  assert.equal(m.rows[0].when, "Nov 6 settle");
  assert.deepEqual(m.rows.slice(1).map((r) => [r.ok, r.why]), [[false, "stale"], [false, "stale"], [false, "missing"], [false, "stale"]], "page-marked, file-marked, no price, a settle sessions behind");
  assert.equal(m.held, 4);
  assert.equal(m.any, true);
  // without the page's stamp there is no honest time: nothing prints
  assert.equal(KIT.model(b, null, NOW).any, false);
  // a Friday settle is current on Saturday and Monday morning, not on Tuesday
  assert.equal(KIT.model({ fetched: PRICES.fetched, rows: [row("corn")] }, PX, Date.parse("2026-11-09T14:00:00Z")).rows[0].ok, true);
  assert.equal(KIT.model({ fetched: PRICES.fetched, rows: [row("corn")] }, PX, Date.parse("2026-11-10T14:00:00Z")).rows[0].ok, false);
  // a last trade is stamped with its time
  const last = { ...quote("corn"), close_kind: "last", close_time: "2026-11-09T19:20:00Z" };
  const ml = KIT.model({ fetched: "2026-11-09T19:31:00Z", rows: [row("corn", { q: last })] }, PX, Date.parse("2026-11-09T19:40:00Z"));
  assert.equal(ml.rows[0].when.replace(/\s/g, " "), "Last trade at the 1:20 pm CT bell; settle not posted yet");
  assert.equal(m.pic, PIC);
  assert.equal(m.date, LONG);
});

test("the model: this week's big report from the page's calendar, in Central time; a bid only when current and timed", () => {
  const ev = HAP.icsEvents(ICS).concat(HAP.cpEvents(NOW));
  const m = KIT.model({ rows: [], events: ev }, PX, NOW);
  assert.deepEqual([m.report.name, m.report.when, m.report.big], ["WASDE and Crop Production", "Tue Nov 10, 11:00 AM CT", true]);
  assert.equal(KIT.reportLine(m), "This week: WASDE and Crop Production, Tue Nov 10, 11:00 AM CT");
  // out earlier today: says so, with its time
  const out = KIT.model({ rows: [], events: ev }, PX, Date.parse("2026-11-10T18:00:00Z"));
  assert.equal(out.report.when, "out today at 11:00 AM CT");
  // no big report in the next seven days: the next release of any kind, named as such; none at all: no line
  const cp = KIT.model({ rows: [], events: HAP.cpEvents(NOW) }, PX, NOW);
  assert.match(KIT.reportLine(cp), /^Next report: Crop Progress, Mon Nov 9, 3:00 PM CT$/);
  assert.equal(KIT.model({ rows: [], events: [] }, PX, NOW).report, null);
  const bid = { label: "Top corn bid within 50 mi", cash: "$4.05", name: "Heartland Co-op", town: "Nevada, IA", month: "Nov", posted: "2026-11-06T20:30:00Z" };
  const mb = KIT.model({ rows: [], bids: [bid, { ...bid, stale: true }, { ...bid, posted: "" }, { ...bid, posted: "2026-11-03T20:30:00Z" }, { ...bid, ageUnknown: true }] }, PX, NOW);
  assert.deepEqual(mb.bids, [{ label: bid.label, cash: "$4.05", name: "Heartland Co-op", town: "Nevada, IA", month: "Nov", posted: "Nov 6, 2:30 PM" }], "old, untimed and 72 h+ bids are left out");
  assert.match(mb.src, /Cash bid as the elevator posted it/);
  assert.doesNotMatch(KIT.model({ rows: [] }, PX, NOW).src, /Cash bid/, "no bid, no bid source");
});

test("the page: the button sits in the Market Prices heading row in the HTML; the kit loads deferred; no em dash in the kit", () => {
  assert.match(HOME, /<span id="prices-age"[^>]*>[^<]*<\/span><button type="button" class="sec-all hk-pic" id="hk-pic" style="[^"]+">Save picture<\/button><a href="\/markets" class="sec-all">All markets<\/a><\/div><\/div>/);
  assert.match(HOME, /<script src="\/components\/home-kit\.js\?v=1" defer><\/script>/);
  assert.match(HOME, /<script src="\/components\/happening\.js\?v=4" defer><\/script>/);
  assert.ok(HOME.indexOf("/components/happening.js?v=") < HOME.indexOf("/components/home-kit.js?v="));
  for (const f of ["components/home-kit.js", "test/share-kit-home.test.mjs"]) assert.ok(!read(f).includes("\u2014"), f + ": no em dash");
  assert.match(JS, /var ASK = 'Free every morning: the AGSIST Daily at agsist\.com';/);
  assert.match(read("components/happening.js"), /api\.events = function \(\) \{ return ev\.slice\(\); \};/);
});

/* ---------------------------------------------------------------- in a browser */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ics": "text/calendar" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html"; else if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const FROZEN = ["/data/cot.json", "/data/cot-history.json", "/data/wasde.json", "/data/crop-progress.json", "/data/cot-questions.json"];
/* the homepage at width w: outside hosts refused, the price file and the calendar from the fixtures (o.prices to
   change them), the live report files refused, the clock fixed, GA events and layout shifts recorded */
async function open(browser, port, w, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 }, isMobile: w < 600, hasTouch: w < 600, timezoneId: "America/Chicago", acceptDownloads: true });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await ctx.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`), (r) => r.abort());
  const prices = o.prices ? o.prices(JSON.parse(JSON.stringify(PRICES))) : PRICES;
  await ctx.route((u) => u.pathname === "/data/prices.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(prices) }));
  await ctx.route((u) => u.pathname === "/usda-calendar.ics", (r) => r.fulfill({ status: 200, contentType: "text/calendar", body: ICS }));
  for (const b of FROZEN.concat(o.block || [])) await ctx.route((u) => u.pathname === b, (r) => r.fulfill({ status: 404, body: "x" }));
  await pg.addInitScript(() => {
    Object.defineProperty(window, "__ga", { get: () => (window.dataLayer || []).filter((a) => a && a[0] === "event").map((a) => [a[1], a[2] || {}]) });
    window.__shifts = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push({ v: e.value, head: (e.sources || []).some((s) => s.node && s.node.closest && s.node.closest("#f-prices .sec-head")) });
    }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.clock.setFixedTime(new Date(NOW));
  await pg.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  return { ctx, pg, errs };
}
/* the board as the page prints it, read here on its own: [price, change, month] per market */
function pageBoard() {
  const t = (e) => (e ? e.textContent.replace(/\s+/g, " ").trim() : "");
  return [["pcp-corn-near", 1], ["pcp-bean-near", 1], ["pcp-wheat", 0], ["pcp-cattle", 0], ["pcp-hogs", 0]].map(([id, card]) => {
    const pe = document.getElementById(id), c = pe.closest(".pc");
    const chg = card ? t(c.querySelector(".pc-chg-val")).replace(/^[▲▼] /, "") : t(c.querySelector(".r7-chg")) + " (" + t(c.querySelector(".r7-pct")) + ")";
    const month = t(c.querySelector(card ? ".pc-contract" : ".r7-cm")).split(" · ")[0];
    return [t(pe), chg, month];
  });
}
const ready = (pg) => pg.waitForFunction(() => window.AgShareKit && window.AgHomeKit && window.AgQR && window.AGSIST_PRICE_DATA && window.AgHappening && window.AgHappening.events().length
  && document.querySelector("#f-prices .r7-row[data-r7k=hogs] .r7-chg").textContent, null, { timeout: 30000 });

test("in a browser: the picture's rows are the page's board, with the page's stamp; the report, the QR code, the download; nothing moves", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const J = jsqr();
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await open(browser, port, w);
      const head0 = await pg.evaluate(() => { const r = document.querySelector("#f-prices .sec-head").getBoundingClientRect(), b = document.getElementById("hk-pic").getBoundingClientRect(); return [r.height, b.height, b.top - r.top]; });
      await ready(pg);
      await pg.waitForTimeout(1200);
      const head1 = await pg.evaluate(() => { const r = document.querySelector("#f-prices .sec-head").getBoundingClientRect(), b = document.getElementById("hk-pic").getBoundingClientRect(); return [r.height, b.height, b.top - r.top]; });
      assert.deepEqual(head1, head0, `${w}: the heading row and the button keep their place while the page loads`);
      const sh = await pg.evaluate(() => window.__shifts.filter((s) => s.head).length);
      assert.equal(sh, 0, `${w}: no layout shift in the button's row`);
      assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${w}: no sideways scroll`);
      const r = await pg.evaluate(async (fn) => {
        const board = new Function("return (" + fn + ")()")();
        await document.fonts.ready;
        const K = window.AgHomeKit, m = K.current(), out = { board, m, stamps: {}, img: [] };
        for (const k of ["corn", "beans", "wheat", "cattle", "hogs"]) out.stamps[k] = window.AgPxStamp.stamp(window.AGSIST_PRICE_DATA[k], document.querySelector("#prices-age time").getAttribute("datetime"));
        for (const wide of [false, true]) {
          const im = K.image(m, document, { qr: window.AgQR.matrix(m.pic, null, null, 10), wide }), c = im.canvas;
          out.img.push({ w: c.width, h: c.height, min: Math.min(...im.sizes), texts: im.texts, px: Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data) });
        }
        return out;
      }, pageBoard.toString());
      assert.deepEqual(r.m.rows.map((x) => [x.price, x.chg, x.month]), r.board, `${w}: the picture's price, change and month are the board's`);
      assert.deepEqual(r.m.rows.map((x) => x.when), ["corn", "beans", "wheat", "cattle", "hogs"].map((k) => r.stamps[k]), "each row's time is the page's own stamp for its quote");
      assert.deepEqual(r.m.rows.map((x) => x.when), Array(5).fill("Nov 6 settle"), "settles labeled as settles, with their day");
      assert.equal(r.board[0][0], "$4.41 1/2");
      assert.equal(r.m.held, 0);
      assert.deepEqual([r.m.report.name, r.m.report.when], ["WASDE and Crop Production", "Tue Nov 10, 11:00 AM CT"]);
      assert.deepEqual(r.m.bids, [], "the bids network is refused here: no bid on the picture");
      for (const [i, [W, H]] of [[1080, 1350], [1200, 630]].entries()) {
        const im = r.img[i], all = im.texts.join("\n");
        assert.deepEqual([im.w, im.h], [W, H]);
        assert.ok(im.min >= 20, `${W}: smallest word ${im.min} px`);
        for (const x of r.m.rows) assert.ok(im.texts.includes(x.price) && all.includes(x.chg) && all.includes(x.when) && all.includes(x.month), `${W}: ${x.name} ${x.price} ${x.chg} ${x.when}`);
        for (const s of [LONG, "Today’s markets", "agsist.com", "WASDE and Crop Production", "Tue Nov 10, 11:00 AM CT", "Free every morning: the AGSIST Daily at agsist.com"]) assert.ok(all.includes(s), `${W}: ${s}`);
        assert.ok(all.includes("Yahoo Finance"), `${W}: the source is named`);
        assert.ok(!all.includes("\u2014"), `${W}: no em dash on the picture`);
        if (J) {
          const code = J(new Uint8ClampedArray(im.px), im.w, im.h);
          assert.ok(code, `${W}: the QR code reads`);
          assert.equal(code.data, PIC, `${W}: back to the homepage with the share tags`);
        }
      }
      if (w === 1280) {
        const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 15000 }), pg.click("#hk-pic")]);
        assert.equal(dl.suggestedFilename(), `agsist-markets-${DAY}.png`);
        const lim = await pg.evaluate(() => window.AgHomeKit.lastImage);
        assert.deepEqual([lim.w, lim.h, lim.qr], [1200, 630, PIC], "the wide picture on a desktop, with its QR code");
        const ga = await pg.evaluate(() => window.__ga);
        assert.ok(ga.some(([n, p]) => n === "share_open" && p.page === "home") && ga.some(([n, p]) => n === "picture_download" && p.page === "home"), JSON.stringify(ga.map(([n]) => n)));
      }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    if (!J) console.log("# jsqr not found: the QR read-back part was not run");
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: a stale quote is withheld and says so; the hero band's top bid shows when the page shows it", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg, errs } = await open(browser, port, 1280, { prices: (d) => { d.quotes.hogs.stale = true; d.stale_keys = ["hogs"]; return d; } });
    await ready(pg);
    await pg.waitForTimeout(800);
    // the hero band paints a bid the way the bids card hands it over (bids-homepage.js dispatchTop)
    await pg.evaluate((now) => { const d = { status: "ok", radiusMi: 50, place: "Nevada, IA",
      corn: { cash: 4.05, basis: -0.37, ref: "Dec '26", name: "Heartland Co-op", town: "Nevada, IA", mi: 3.2, posted: new Date(now - 3 * 36e5).toISOString(), stale: false, month: "Nov", boardKey: "x", higherOlder: null, ageUnknown: false },
      soybeans: { cash: 10.95, basis: -0.99, ref: "Jan '27", name: "Old Board", town: "Ames, IA", mi: 9, posted: new Date(now - 100 * 36e5).toISOString(), stale: true, month: "Nov", boardKey: "y", higherOlder: null, ageUnknown: false } }; window.__agsistBidsTop = d; window.dispatchEvent(new CustomEvent("agsist:bids-top", { detail: d })); }, NOW);
    const r = await pg.evaluate(async () => {
      await document.fonts.ready;
      const m = window.AgHomeKit.current(), im = window.AgHomeKit.image(m, document, { qr: null });
      return { m, texts: im.texts, hog: document.getElementById("pcp-hogs").textContent.trim(), cell: document.querySelector("#hb-corn-v .hb-n").textContent, label: document.getElementById("hb-corn-k").textContent };
    });
    const hogs = r.m.rows.find((x) => x.key === "hogs");
    assert.deepEqual([hogs.ok, hogs.why], [false, "stale"], "the page marks the hog quote not updated: withheld");
    assert.ok(!r.texts.includes(hogs.price) && r.texts.join("\n").includes("No current quote, not shown"), "its price is not drawn, and the gap is said");
    assert.ok(r.m.rows.filter((x) => x.ok).length === 4);
    assert.deepEqual(r.m.bids.map((b) => [b.label, b.cash, b.name, b.posted]), [[r.label, r.cell, "Heartland Co-op", "Nov 7, 5:00 AM"]], "the corn bid as the hero cell prints it; the old soybean board is left out");
    assert.ok(r.texts.some((t) => t.includes("$4.05") && t.includes("Heartland Co-op")));
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: without share-kit.js the page works and the button says it is unavailable", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg, errs } = await open(browser, port, 390, { block: ["/components/share-kit.js"] });
    await pg.waitForFunction(() => document.getElementById("hk-pic").disabled, null, { timeout: 20000 });
    const s = await pg.evaluate(() => ({ title: document.getElementById("hk-pic").title, kit: !!window.AgShareKit, corn: document.getElementById("pcp-corn-near").textContent.trim() }));
    assert.match(s.title, /Not available right now/);
    assert.equal(s.kit, false);
    assert.equal(s.corn, "$4.41 1/2", "the board works as ever");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
