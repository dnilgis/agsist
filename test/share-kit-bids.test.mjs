/* The Bids near kit (share kit wave 1 step 2, Nov 7, 2026): components/bids-kit.js on the cash bid town pages
 * (scripts/build_cash_bid_pages.py skb_rows / skb_html) and on /cash-bids (window.cbKitData in cash-bids.js).
 *
 *   node --test test/share-kit-bids.test.mjs
 *
 * Every page here is built by the test itself: Nevada, IA from the frozen fixture test/fixtures/share-kit-bids/story-ia.json
 * (the 11 boards of test/fixtures/chaosbids, bids data of Nov 4, 2026) into a temp folder; /cash-bids reads the frozen
 * chaosbids data in place of the bids network. Clocks come from the fixtures, never from today.
 *   - the picture's and the sheet's rows are the page's own top bids: each elevator once, at the price the page prints
 *     for it, highest first; each with its posted time; a row with no posted time, or past its window, is withheld
 *   - the sheet is one page on Letter and on A4; Ctrl+P prints it; "Not a contract. Call before you haul."
 *   - the QR code reads back to the page with the print tags (utm_campaign <page>-<date>)
 *   - without share-kit.js the page works and the two buttons say they are unavailable
 *   - the buttons are in the HTML: nothing moves while the page loads; no em dash anywhere in the kit
 * Browser parts need Playwright and Chromium; the QR part needs jsqr (JSQR_PATH or npm i jsqr). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const FIX = join(ROOT, "test/fixtures/share-kit-bids/story-ia.json");
const BIDS = join(ROOT, "test/fixtures/chaosbids/");
const fx = JSON.parse(readFileSync(FIX, "utf8"));
const NOW = Date.parse(fx.now);
/* the fixture's own day, in the Central time the site's day runs on: "2026-11-04" and "November 4, 2026" */
const DAY = new Date(NOW).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const LONG = new Date(NOW).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;
function jsqr() { for (const p of [process.env.JSQR_PATH, process.env.JSQR_PATH && join(process.env.JSQR_PATH, "node_modules/jsqr"), "jsqr"].filter(Boolean)) { try { return require(p); } catch (e) { /* next */ } } return null; }
const qctx = { window: {} };
vm.createContext(qctx);
vm.runInContext(read("components/qr.js"), qctx);
const Q = qctx.window.AgQR;
const KIT = require(join(ROOT, "components/bids-kit.js"));
const JS = read("components/bids-kit.js"), CSS = read("components/bids-kit.css");

/* Nevada, IA, written by the builder into a temp folder */
const OUT = mkdtempSync(join(tmpdir(), "skbids-"));
process.on("exit", () => { try { rmSync(OUT, { recursive: true, force: true }); } catch (e) {} });
{
  const py = "import sys; sys.path.insert(0, sys.argv[1]); import build_cash_bid_pages as B; " +
    "B.BUY.load = lambda root='.': []; B.build_fixture_town(sys.argv[2], sys.argv[3] + '/cash-bids', root=sys.argv[3])";
  const r = spawnSync("python3", ["-c", py, join(ROOT, "scripts"), FIX, OUT], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `fixture build failed: ${(r.stderr || "").slice(-800)}`);
}
const PAGE = readFileSync(join(OUT, "cash-bids/iowa/nevada.html"), "utf8");
const unesc = (s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&rsquo;/g, "’").replace(/&middot;/g, "·").replace(/&amp;/g, "&");
const DATA = JSON.parse(/<script type="application\/json" id="skb-data">(.*?)<\/script>/.exec(PAGE)[1].replace(/<\\\//g, "</"));
const CENTRAL = (iso) => {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
  return `${p.month} ${p.day}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
};

/* The page's own prices per elevator: each card's rows (crop, cash) and the nearby list's "Crop $x" per elevator */
function pagePrices() {
  const out = [];
  for (const m of PAGE.matchAll(/<section class="cbt-el"><h2>(.*?)<\/h2>(.*?)<\/section>/gs)) {
    const name = unesc(m[1]);
    for (const r of m[2].matchAll(/<tr><td>(Corn|Soybeans)[^<]*(?:<span[^>]*>[^<]*<\/span>)?<\/td><td>[^<]*<\/td><td class="n">(\$[\d.]+)<\/td>/g))
      out.push({ name, town: "Nevada", crop: r[1].toLowerCase(), cash: r[2], own: true });
  }
  const near = /<h2 id="nearby">.*?<\/ul>/s.exec(PAGE)[0];
  for (const li of near.matchAll(/<li><a href="([^"]+)"><b>(.*?)<\/b>, ([^<]*?), IA<\/a>.*?<span class="np">(.*?)<\/span><\/li>/gs))
    for (const p of li[4].matchAll(/(Corn|Soybeans) (\$[\d.]+)/g)) out.push({ name: unesc(li[2]), town: unesc(li[3]), crop: p[1].toLowerCase(), cash: p[2], own: false, path: li[1] });
  return out;
}

test("the builder writes the two buttons in the share row, the page's data and the script before the signup box's", () => {
  assert.match(PAGE, /<p class="cbt-share"><a class="cbt-share-btn" [^>]*data-share-bid [^>]*>Share today&rsquo;s bids<\/a><button type="button" class="cbt-share-btn" id="skb-pic">Save picture<\/button><button type="button" class="cbt-share-btn" id="skb-print">Print bid sheet<\/button><span class="skb-st" role="status" aria-live="polite"><\/span><\/p>/);
  const kit = PAGE.indexOf("/components/bids-kit.js?v=1"), box = PAGE.indexOf("/components/cb-signup.js?v=");
  assert.ok(kit > 0 && box > kit, "bids-kit.js runs before cb-signup.js reads the box's source");
  assert.equal((PAGE.match(/bids-kit\.js\?v=/g) || []).length, 1);
  assert.match(PAGE, /cash-bid-town\.css\?v=3/);
  assert.equal(DATA.place, "Nevada, IA");
  assert.equal(DATA.url, "https://agsist.com/cash-bids/iowa/nevada");
  assert.equal(DATA.page, "cash-bids-iowa-nevada");
  assert.equal(DATA.n, 5);
  assert.ok(PAGE.length < 150 * 1024, "under the 150 KB page cap");
});

test("the rows are the page's own top bids: each elevator once, at its printed price, highest first, with its posted time", () => {
  const prices = pagePrices();
  for (const crop of ["corn", "soybeans"]) {
    const rows = DATA.rows[crop];
    assert.ok(rows.length >= 5, `${crop}: five or more candidates (${rows.length})`);
    // every elevator on the page with a price for this crop is a candidate, once
    const onPage = prices.filter((p) => p.crop === crop);
    assert.equal(rows.length, new Set(onPage.map((p) => p.name + "|" + p.town)).size, `${crop}: every elevator on the page, once`);
    for (const r of rows) {
      // the price is one the page prints for that elevator (its card's table, or its nearby line)
      const hit = onPage.filter((p) => p.name === r.n && p.town === r.t);
      assert.ok(hit.length, `${crop}: ${r.n}, ${r.t} is on the page`);
      assert.ok(hit.some((p) => p.cash === r.c), `${crop}: ${r.n}, ${r.t} ${r.c} is a price the page prints (${hit.map((p) => p.cash)})`);
      // the nearby list's price is that elevator's own headline price, so it must match exactly
      for (const p of hit.filter((x) => !x.own)) assert.equal(p.cash, r.c, `${r.n}, ${r.t}: the nearby list's price`);
      // the posted time is the fixture row's own
      const src = fx.merged.bids.filter((b) => b.crop === crop && Math.floor(Date.parse(b.pricedAt) / 1000) === Date.parse(r.p) / 1000);
      assert.ok(src.length, `${r.n}: posted ${r.p} is a fixture row's own time`);
      assert.ok(Date.parse(r.u) > Date.parse(r.p), "it counts for a while after it was posted");
    }
    // highest first (by the posted price)
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].v >= rows[i].v, `${crop}: highest first at ${i}`);
  }
});

test("the model takes the first five that still count; no posted time or past its window is withheld; times are Central", () => {
  const m = KIT.model(DATA, NOW);
  assert.equal(m.title, "Bids near Nevada, IA");
  assert.equal(m.date, LONG);
  for (const c of m.crops) {
    const want = DATA.rows[c.key].slice(0, 5);
    assert.deepEqual(c.rows.map((r) => [r.name, r.cash, r.at]), want.map((r) => [r.n, r.c, r.p]), `${c.key}: the page's top five`);
    for (const r of c.rows) assert.equal(r.posted, CENTRAL(r.at));
  }
  // withheld: a row with no posted time, and one past its window; the next one moves up, nothing is filled in
  const d = JSON.parse(JSON.stringify(DATA));
  d.rows.corn[0].p = "";
  d.rows.corn[1].u = new Date(NOW - 1000).toISOString();
  const w = KIT.model(d, NOW), corn = w.crops[0].rows;
  assert.deepEqual(corn.map((r) => r.cash), DATA.rows.corn.slice(2, 7).map((r) => r.c));
  assert.equal(w.held, 2);
  assert.match(KIT.html(w, ""), /2 bids past the window they were posted for, or with no posted time, left out\./);
  // three days on, every row is past its window: nothing prints as today's
  const late = KIT.model(DATA, NOW + 4 * 864e5);
  assert.equal(late.any, false);
  assert.ok(late.crops.every((c) => c.rows.length === 0));
});

test("the sheet carries every row with its posted time, the notice, the address and the source", () => {
  const m = KIT.model(DATA, NOW), h = KIT.html(m, "<svg></svg>");
  for (const c of m.crops) for (const r of c.rows) {
    assert.ok(h.includes(KIT.posted(r.at)), "posted " + r.at);
    assert.ok(h.includes(`<td class="skbs-n skbs-c">${r.cash}</td>`), r.cash);
  }
  assert.match(h, /<p class="skbs-not">Not a contract\. Call before you haul\.<\/p>/);
  assert.match(h, /agsist\.com\/cash-bids\/iowa\/nevada/);
  assert.match(h, /Scan for the live bids/);
  assert.match(h, /each elevator posted them on its own bid board/);
  assert.doesNotMatch(h, /undefined|NaN|\bnull\b/);
});

test("the QR code and the picture link read back to the page with the kit's tags", (t) => {
  const m = KIT.model(DATA, NOW);
  assert.equal(m.qr, `https://agsist.com/cash-bids/iowa/nevada?utm_source=print&utm_medium=qr&utm_campaign=cash-bids-iowa-nevada-${DAY}`);
  assert.equal(m.pic, `https://agsist.com/cash-bids/iowa/nevada?utm_source=share&utm_medium=picture&utm_campaign=cash-bids-iowa-nevada-${DAY}`);
  const jsQR = jsqr();
  if (!jsQR) return t.skip("jsqr is not installed (npm i jsqr@1.4.0, or set JSQR_PATH)");
  for (const u of [m.qr, m.pic, `https://agsist.com/cash-bids?zip=50010&r=50&utm_source=print&utm_medium=qr&utm_campaign=cash-bids-${DAY}`]) {
    const q = Q.matrix(u, null, null, 10), k = 6, n = (q.length + 8) * k, px = new Uint8ClampedArray(n * n * 4).fill(255);
    q.forEach((r, y) => r.forEach((v, x) => {
      if (!v) return;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const o = (((y + 4) * k + dy) * n + (x + 4) * k + dx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    }));
    const r = jsQR(px, n, n);
    assert.equal(r && r.data, u, "reads back");
    assert.ok((q.length - 17) / 4 <= 8, `version ${(q.length - 17) / 4}, small enough to scan at an inch`);
  }
});

test("copy rules: no em dash; black and white sheet with the dark gold; the notice word for word", () => {
  for (const [n, s] of [["bids-kit.js", JS], ["bids-kit.css", CSS], ["page", PAGE]]) assert.doesNotMatch(s, /—/, n + ": no em dash");
  assert.match(CSS, /#8a6514/);
  assert.doesNotMatch(CSS, /#d4a23f/, "never the screen gold on paper");
  assert.match(CSS, /\.skbs-src\{font-size:8\.5pt/);
  assert.match(JS, /var NOTICE = 'Not a contract\. Call before you haul\.';/);
  const cb = read("components/cash-bids.js");
  assert.match(cb, /window\.cbKitData=function\(\)\{/);
  const h = read("cash-bids.html");
  assert.match(h, /<p class="cb-kit"><button type="button" class="cb-kit-btn" id="skb-pic">Save picture<\/button><button type="button" class="cb-kit-btn" id="skb-print">Print bid sheet<\/button>/);
  assert.ok(h.indexOf("/components/bids-kit.js?v=1") < h.indexOf("/components/cb-signup.js?v="), "/cash-bids: the kit before the signup box");
  assert.ok(h.indexOf('id="skb-pic"') > h.indexOf('id="best-bids-section"') && h.indexOf('id="skb-pic"') < h.indexOf("data-bid-alerts"), "inside the results section, which appears with the results");
});

/* ---------------------------------------------------------------- in a browser */
function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/cash-bids") p = "/cash-bids.html"; else if (!extname(p)) p += ".html";
    let f = normalize(join(OUT, p));
    if (!f.startsWith(OUT) || !existsSync(f) || statSync(f).isDirectory()) f = normalize(join(ROOT, p));
    if ((!f.startsWith(ROOT) && !f.startsWith(OUT)) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
const pdfPages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
const J = (body) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
/* a page at width w: every off-site request refused (the bids network from the frozen chaosbids copy), the clock
   fixed, service workers blocked, GA events and layout shifts recorded; o.block: paths answered 404 */
async function open(browser, port, path, w, now, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: 900 }, isMobile: w < 600, hasTouch: w < 600, timezoneId: "America/Chicago" });
  const pg = await ctx.newPage(), errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  await ctx.route((u) => !u.href.startsWith(`http://127.0.0.1:${port}`) && !u.href.startsWith("https://dnilgis.github.io/bids/"), (r) => r.abort());
  await ctx.route((u) => u.href.startsWith("https://dnilgis.github.io/bids/"), (r) => {
    const f = BIDS + new URL(r.request().url()).pathname.replace("/bids/", "");
    return existsSync(f) ? r.fulfill(J(readFileSync(f, "utf8"))) : r.fulfill({ status: 404, body: "x" });
  });
  for (const b of o.block || []) await ctx.route((u) => u.pathname === b, (r) => r.fulfill({ status: 404, body: "x" }));
  await pg.addInitScript(() => {
    /* GA events as the page's own gtag() queues them (window.dataLayer); nothing leaves the page */
    Object.defineProperty(window, "__ga", { get: () => (window.dataLayer || []).filter((a) => a && a[0] === "event").map((a) => [a[1], a[2] || {}]) });
    window.__shifts = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shifts.push(e.value); }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.clock.setFixedTime(new Date(now));
  await pg.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "load" });
  return { ctx, pg, errs };
}

test("in a browser: the town page's picture (phone and wide) and its one-page sheet; Ctrl+P prints it; nothing moves", { skip, timeout: 240000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const w of [390, 1280]) {
      const { ctx, pg, errs } = await open(browser, port, "/cash-bids/iowa/nevada", w, NOW + 30 * 60e3);
      await pg.waitForFunction(() => window.AgShareKit && window.AgBidsKit && window.AgQR, null, { timeout: 20000 });
      await pg.waitForTimeout(800);
      const shift = await pg.evaluate(() => window.__shifts.reduce((a, b) => a + b, 0));
      assert.ok(shift < 0.01, `${w}: no layout shift while the kit loads (${shift})`);
      const before = await pg.evaluate(() => [document.querySelector("main").getBoundingClientRect().height, document.documentElement.scrollHeight]);
      const info = await pg.evaluate(() => {
        const b = window.AgBidsKit.build();
        return { fit: b.el.dataset.fit, shown: getComputedStyle(b.el).display, text: b.el.innerText, qr: !!b.el.querySelector(".skbs-qr svg"),
          rows: b.m.crops.map((c) => c.rows.map((r) => [r.name, r.cash, r.posted])) };
      });
      const after = await pg.evaluate(() => [document.querySelector("main").getBoundingClientRect().height, document.documentElement.scrollHeight]);
      assert.deepEqual(after, before, `${w}: building the sheet moves nothing`);
      assert.equal(info.shown, "none", "hidden on screen");
      assert.equal(info.fit, "1", "fits one page unscaled");
      assert.ok(info.qr, "QR code on the sheet");
      const want = ["corn", "soybeans"].map((c) => DATA.rows[c].slice(0, 5).map((r) => [r.n, r.c, CENTRAL(r.p)]));
      assert.deepEqual(info.rows, want, "the sheet's rows are the page's top five per crop, with posted times");
      for (const c of want) for (const [n, cash, posted] of c) assert.ok(info.text.includes(posted) && info.text.includes(cash) && info.text.includes(n), `${n} ${cash} ${posted} on the sheet`);
      assert.match(info.text, /Not a contract\. Call before you haul\./);
      assert.ok(info.text.includes(LONG), "the date block: " + LONG);
      // any browser print gives the sheet, one page on Letter and on A4
      await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      assert.ok(await pg.evaluate(() => document.documentElement.classList.contains("skbs-on")), "Ctrl+P switches print to the sheet");
      await pg.emulateMedia({ media: "print" });
      for (const format of ["Letter", "A4"]) assert.equal(pdfPages(await pg.pdf({ format, printBackground: true })), 1, `one ${format} page`);
      await pg.emulateMedia({ media: "screen" });
      await pg.evaluate(() => window.dispatchEvent(new Event("afterprint")));
      assert.ok(!(await pg.evaluate(() => document.documentElement.classList.contains("skbs-on"))));
      assert.ok((await pg.evaluate(() => window.__ga)).some(([n, p]) => n === "sheet_print" && p.page === "cash-bids-iowa-nevada"), "sheet_print at the print");
      // the pictures: 1080 x 1350 and 1200 x 630, every row's cash and posted time drawn, every word 20 px or more
      for (const [wide, W, H] of [[false, 1080, 1350], [true, 1200, 630]]) {
        const im = await pg.evaluate(async (wide) => {
          await document.fonts.ready;
          const K = window.AgBidsKit, m = K.current(), r = K.image(m, document, { qr: window.AgQR.matrix(m.pic, null, null, 10), wide });
          return { w: r.canvas.width, h: r.canvas.height, min: Math.min(...r.sizes), texts: r.texts };
        }, wide);
        assert.deepEqual([im.w, im.h], [W, H]);
        assert.ok(im.min >= 20, `smallest word ${im.min} px`);
        const all = im.texts.join("\n");
        for (const c of want) for (const [n, cash, posted] of c) assert.ok(im.texts.includes(cash) && all.includes(posted) && all.includes(n), `${W}: ${n} ${cash} ${posted}`);
        assert.ok(all.includes("Bids near Nevada, IA") && all.includes("Not a contract. Call before you haul.") && all.includes(LONG));
      }
      // Save picture: a PNG download on a desktop (picture_download), never a navigation
      if (w === 1280) {
        const [dl] = await Promise.all([pg.waitForEvent("download", { timeout: 15000 }), pg.click("#skb-pic")]);
        assert.equal(dl.suggestedFilename(), `agsist-cash-bids-iowa-nevada-${DAY}.png`);
        const lim = await pg.evaluate(() => window.AgBidsKit.lastImage);
        assert.deepEqual([lim.w, lim.h], [1200, 630], "the wide picture on a desktop");
        const ga = (await pg.evaluate(() => window.__ga)).map(([n]) => n);
        assert.ok(ga.includes("share_open") && ga.includes("picture_download"), JSON.stringify(ga));
      }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: without share-kit.js the page works and the buttons say they are unavailable", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg, errs } = await open(browser, port, "/cash-bids/iowa/nevada", 390, NOW + 30 * 60e3, { block: ["/components/share-kit.js"] });
    await pg.waitForFunction(() => document.getElementById("skb-pic").disabled, null, { timeout: 15000 });
    const s = await pg.evaluate(() => ({ pic: document.getElementById("skb-pic").title, print: document.getElementById("skb-print").disabled,
      st: document.querySelector(".skb-st").textContent, share: !!document.querySelector("[data-share-bid]"), tables: document.querySelectorAll(".cbt-t").length }));
    assert.match(s.pic, /Not available right now/);
    assert.ok(s.print, "Print bid sheet is marked unavailable");
    assert.match(s.st, /not available right now/);
    assert.ok(s.share && s.tables >= 2, "the page and its other share button work as ever");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: an arrival from the sheet's QR code marks the Daily box's source and sends qr_visit once", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { ctx, pg } = await open(browser, port, "/cash-bids/iowa/nevada?utm_source=print&utm_medium=qr&utm_campaign=cash-bids-iowa-nevada-" + DAY, 390, NOW + 30 * 60e3);
    await pg.waitForFunction(() => window.AgShareKit && document.querySelector("#bid-email[data-cbs-ready]"), null, { timeout: 20000 }).catch(() => {});
    const r = await pg.evaluate(() => ({ src: document.getElementById("bid-email").getAttribute("data-source"), ga: window.__ga.filter(([n]) => n === "qr_visit").length }));
    assert.equal(r.src, "town:iowa/nevada|print-qr");
    assert.equal(r.ga, 1);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});

test("in a browser: /cash-bids builds the kit from its own Best price ranking for the search on screen", { skip, timeout: 180000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const gen = Date.parse(JSON.parse(readFileSync(BIDS + "data/merged-index.json", "utf8")).generated);
  try {
    const { ctx, pg, errs } = await open(browser, port, "/cash-bids?zip=50010", 1280, gen + 16 * 36e5);
    await pg.waitForFunction(() => document.getElementById("best-bids-grid").children.length > 0 && window.cbKitData && window.cbKitData() && window.AgShareKit, null, { timeout: 40000 });
    await pg.waitForTimeout(1000);
    const r = await pg.evaluate(() => {
      const d = window.cbKitData(), m = window.AgBidsKit.model(d, Date.now()), card = document.querySelector(".best-bid-card.corn-t .bbc-price");
      const bc = document.querySelector(".best-bid-card.corn-t");
      return { d, m: m.crops.map((c) => c.rows.map((x) => [x.name, x.cash, x.posted])), best: card && card.textContent.trim(), qr: m.qr, title: m.title,
        bestName: bc && bc.querySelector(".bbc-name").textContent.trim(), bestText: bc && bc.textContent,
        visible: getComputedStyle(document.getElementById("skb-pic")).display !== "none" };
    });
    assert.equal(r.title, "Bids near ZIP 50010");
    assert.ok(r.visible);
    assert.ok(r.m[0].length >= 1 && r.m[0].length <= 5 && r.m[1].length <= 5, JSON.stringify(r.m));
    // the first corn row is the Best corn card's elevator at the price it posted (a card re-marking a day-old price
    // on today's futures shows "posted <day> $x" under its estimate; the kit prints only the posted price)
    assert.equal(r.m[0][0][0], r.bestName, "the first corn row is the Best corn card's elevator");
    assert.ok(r.best === r.m[0][0][1] || r.bestText.includes(" " + r.m[0][0][1]), `the card prints ${r.m[0][0][1]}: ${r.bestText}`);
    for (const c of r.m) for (const [, , posted] of c) assert.match(posted, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d [AP]M$/, "a posted time on every row");
    for (const c of ["corn", "soybeans"]) for (const x of r.d.rows[c]) assert.ok(x.p && !Number.isNaN(Date.parse(x.p)));
    assert.match(r.qr, /^https:\/\/agsist\.com\/cash-bids\?zip=50010&r=50&utm_source=print&utm_medium=qr&utm_campaign=cash-bids-\d{4}-\d\d-\d\d$/);
    const sheet = await pg.evaluate(() => { const b = window.AgBidsKit.build(); return { fit: b.el.dataset.fit, text: b.el.innerText }; });
    assert.equal(sheet.fit, "1");
    assert.match(sheet.text, /Not a contract\. Call before you haul\./);
    await pg.emulateMedia({ media: "print" });
    await pg.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    for (const format of ["Letter", "A4"]) assert.equal(pdfPages(await pg.pdf({ format, printBackground: true })), 1, `/cash-bids: one ${format} page`);
    assert.deepEqual(errs.filter((e) => !/Failed to fetch|NetworkError|net::/.test(e)), []);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
