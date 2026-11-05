/* The 52-week funds chart on /cot (2026-11-05, Sig: "I want the 52-week COT chart enhanced and made near the top
 * of the page ... I can picture people sharing it if we make it easy"). components/cot-chart.js.
 *   - one chart, right under the at-a-glance lines and above the email ask; on a 390 px phone its top is on the
 *     first screen or one short scroll down (the lines past the third wait behind "All 11 markets" there);
 *   - one market at a time, corn by default, the pick in the link (?m=soybeans);
 *   - the last point is cot.json's net for that market; the title is the glance line without the percentile;
 *   - the price strip only when every week has a close (none for lean hogs or Minneapolis wheat, and none when a
 *     week is missing), never a second scale on the net;
 *   - Share this chart calls the phone's share sheet with the market's link, or copies it; Save image is a
 *     1200x675 PNG carrying agsist.com/cot and the report date;
 *   - the home card's lines open /cot on their market.
 * Frozen inputs: test/fixtures/funds (cot.json, cot-analysis.json and cot-history.json for the Oct 27, 2026 report).
 * The browser parts route every outside host to a stub or abort and block service workers (BUILD-RULES 58).
 *
 *   node --test test/cot-chart.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, "components/cot-glance.js"));
const C = require(path.join(ROOT, "components/cot-chart.js"));
const FIX = {
  cot: path.join(ROOT, "test/fixtures/funds/cot-2026-10-27.json"),
  cx: path.join(ROOT, "test/fixtures/funds/cot-analysis-2026-10-27.json"),
  hist: path.join(ROOT, "test/fixtures/funds/cot-history-2026-10-27.json"),
};
const COT = JSON.parse(fs.readFileSync(FIX.cot, "utf8"));
const CX = JSON.parse(fs.readFileSync(FIX.cx, "utf8"));
const HIST = JSON.parse(fs.readFileSync(FIX.hist, "utf8"));
const DASH = /[–—]|&mdash;|&ndash;/;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ the model
test("the last point is cot.json's net, and the title is that market's glance line without the percentile", () => {
  for (const k of G.ORDER) {
    const m = C.model(k, HIST, COT, CX);
    assert.ok(m, k);
    assert.equal(m.rows.length, 52, k + ": 52 weekly reports");
    assert.equal(m.last.net, COT[k].net, k + ": the latest point equals cot.json");
    assert.equal(m.last.date, "2026-10-27");
    assert.equal(m.headline, G.headline(k, COT, CX).text, k);
    assert.ok(!/percentile/.test(m.headline) && m.headline.startsWith("Funds are "), m.headline);
    assert.equal(m.hi.net, Math.max(...m.rows.map((r) => r.net)), k + " high");
    assert.equal(m.lo.net, Math.min(...m.rows.map((r) => r.net)), k + " low");
    assert.equal(m.hi.net, COT[k].max52, k + ": the high agrees with the card's 52-wk range");
    assert.equal(m.lo.net, COT[k].min52, k + ": the low agrees with the card's 52-wk range");
    assert.ok(m.src.startsWith("CFTC Commitments of Traders, managed money, futures only, as of Oct 27, released Oct 30."), m.src);
    assert.ok(!DASH.test(m.src + m.headline + m.priceWhy), "no dashes");
  }
  assert.equal(C.model("beans", HIST, COT, CX).headline, "Funds are fairly heavily long soybeans and sold a net 27,544 contracts this week.");
});

test("no title is claimed when the chart's last week is not the report on the page, or the nets differ", () => {
  const next = { ...clone(COT), report_date: "November 3, 2026" };
  assert.equal(C.model("corn", HIST, next, CX).headline, null, "a different week: no title");
  const moved = clone(COT); moved.corn.net += 1;
  assert.equal(C.model("corn", HIST, moved, CX).headline, null, "a different net: no title");
  const m = C.model("corn", HIST, COT, null);
  assert.equal(m.headline, "Funds are long corn and sold a net 83,310 contracts this week.", "without the analysis: no weight word");
  assert.equal(m.src, "CFTC Commitments of Traders, managed money, futures only, as of Oct 27. Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.", "no release day without the analysis");
});

test("the price strip is drawn only when every week has a close, and says why when it is not", () => {
  for (const k of ["corn", "beans", "wheat", "kcwheat", "soymeal", "soyoil", "livecattle", "feedercattle", "milk"]) {
    const m = C.model(k, HIST, COT, CX);
    assert.equal(m.price, true, k);
    assert.equal(m.rows.at(-1).price, m.last.raw, k + ": the adjusted line ends on the last close");
    assert.ok(m.src.includes("Yahoo Finance"), "the price source is named where the price shows");
  }
  const hogs = C.model("leanhogs", HIST, COT, CX), mpls = C.model("mplswheat", HIST, COT, CX);
  assert.equal(hogs.price, false);
  assert.match(hogs.priceWhy, /rolls/);
  assert.equal(mpls.price, false);
  assert.equal(mpls.priceWhy, "No price line: our futures feed does not carry this contract.");
  assert.ok(!hogs.src.includes("Price:") && !mpls.src.includes("Price:"), "no price credit without a price");
  // one week without a close: no half-drawn line
  const gap = clone(HIST); delete gap.history.corn[20].price;
  const m = C.model("corn", gap, COT, CX);
  assert.equal(m.price, false);
  assert.match(m.priceWhy, /some weeks have no futures close/);
  const g = C.layout(m, 340, 300, { fs: 12 });
  assert.equal(g.items.filter((i) => i.ink === "price").length, 0, "nothing drawn in price ink");
  // a market the analysis withholds is not drawn even with closes on file
  const cx = clone(CX); cx.commodities.corn.price_withheld_reason = "withheld, not missing: rolls not repaired";
  assert.equal(C.model("corn", HIST, COT, cx).price, false);
});

test("the layout marks zero, this week's number and the 52-week high and low, text 12 px or more", () => {
  for (const k of G.ORDER) {
    const m = C.model(k, HIST, COT, CX), g = C.layout(m, 340, 300, { fs: 12 });
    const texts = g.items.filter((i) => i.t === "text");
    const s = texts.map((i) => i.s);
    assert.ok(texts.every((i) => i.size >= 12), k + ": every label 12 px or more");
    assert.ok(s.includes("0"), k + ": zero labelled");
    assert.ok(s.some((x) => /^(Funds )?long ↑$/.test(x)) || g.Y(0) - g.T < 22, k + ": the long side named: " + s.join(" | "));
    assert.ok(s.some((x) => /^(Funds )?short ↓$/.test(x)) || g.netB - g.Y(0) < 22, k + ": the short side named: " + s.join(" | "));
    assert.ok(s.some((x) => x.startsWith(C.netWords(COT[k].net))), k + ": this week's number");
    assert.ok(s.some((x) => /52-wk high/.test(x)) && s.some((x) => /52-wk low/.test(x)), k + ": high and low");
    const y0 = g.items.find((i) => i.t === "line" && i.ink === "zero");
    assert.ok(y0 && y0.width >= 1.5, "zero drawn plainly");
  }
  assert.equal(C.netWords(193781), "193,781 long");
  assert.equal(C.netWords(-74606), "74,606 short");
  assert.equal(C.px("beans", 1229.25), "$12.29¼/bu");
  assert.equal(C.px("livecattle", 230), "$230.00/cwt");
});

test("/cot carries one chart, under the lines and above the ask, and loads the bumped scripts", () => {
  const cot = read("cot.html");
  const lines = cot.indexOf('id="cg-lines"'), box = cot.indexOf('id="cot-chart-box"'), ask = cot.indexOf('data-topic="cot"'), all = cot.indexOf('id="cot-all"');
  assert.ok(lines > 0 && lines < box && box < ask && ask < all, "lines, chart, ask, details");
  assert.ok(!/<canvas id="cot-chart"|id="chart-tabs"|cot-chart-tab/.test(cot), "the old chart lower down is gone");
  assert.ok(!/drawChart|setActiveTab|cot-chart-tab/.test(read("components/cot-page.js")), "and its code");
  const i = (s) => cot.indexOf(`<script src="/components/${s}"></script>`);
  assert.ok(i("cot-glance.js?v=2") > 0 && i("cot-glance.js?v=2") < i("cot-chart.js?v=1") && i("cot-chart.js?v=1") < i("cot-page.js?v=6"));
  assert.match(cot, /\.cc-plot\{[^}]*height:300px/, "the plot's height is held before it draws");
  assert.match(cot, /\.cc-chip\{[^}]*min-height:44px/);
  assert.match(cot, /\.cc-btn\{[^}]*min-height:44px/);
  const js = read("components/cot-chart.js");
  assert.ok(!DASH.test(js.replace(/\/\*[\s\S]*?\*\//g, "")), "no dashes in the chart's words");
  // no new library: inline SVG and a canvas drawn by our own file, nothing loaded from another host
  assert.deepEqual([...cot.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]).filter((x) => !/googletagmanager/.test(x)), [], "no outside script");
  assert.ok(Buffer.byteLength(js) < 40000, "the chart file stays small: " + Buffer.byteLength(js) + " bytes");
});

test("the home card's lines open /cot on their market", () => {
  assert.match(read("components/home.js"), /<a class="cot-gl-a" href="'\+\(G\.href\?G\.href\(l\.key\):'\/cot'\)\+'">/);
  assert.equal(G.href("beans"), "/cot?m=soybeans");
  for (const k of G.ORDER) assert.equal(G.keyOf(G.SLUG[k]), k);
  assert.equal(G.keyOf("nonsense"), null);
  const idx = read("index.html");
  for (const s of ["components/cot-glance.js?v=2", "components/home.js?v=24", "css/home.css?v=36"]) assert.ok(idx.includes("/" + s + '"'), s);
});

// ---------------------------------------------------------------- in a browser
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (fs.existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !fs.existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    if (!path.extname(p)) p += ".html";
    const f = path.normalize(path.join(ROOT, p));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
    res.end(fs.readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
// every outside host aborted (the worker answered with a stub); our data files from the frozen fixtures
async function open(browser, port, url, o = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", acceptDownloads: true, hasTouch: !!o.touch, viewport: { width: o.width || 390, height: o.width > 900 ? 900 : 844 } });
  const pg = await ctx.newPage();
  if (o.init) await pg.addInitScript(o.init);
  const own = { "/data/cot.json": fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx), "/data/cot-history.json": fs.readFileSync(FIX.hist) };
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.origin === `http://127.0.0.1:${port}`) {
      if (own[u.pathname]) return r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] });
      return r.continue();
    }
    if (u.origin === "https://agsist-api.dnilgis.workers.dev")
      return r.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ ok: true }) });
    return r.abort();
  });
  await pg.clock.setFixedTime(new Date("2026-11-04T15:46:20Z"));
  await pg.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest && /Funds are/.test(document.getElementById("cc-head").textContent); });
  return pg;
}
/* records the chart box's height at first paint, and every layout shift */
const WATCH = () => {
  window.__cls = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, in: e.sources.some((s) => s.node && s.node.closest && s.node.closest("#cot-chart-box")) }); }).observe({ type: "layout-shift", buffered: true });
  document.addEventListener("DOMContentLoaded", () => { const b = document.getElementById("cot-chart-box"); window.__h0 = b ? b.getBoundingClientRect().height : -1; });
};

test("/cot: the chart sits under the lines, near the first screen, corn by default, its box held from first paint", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const pg = await open(browser, port, "/cot", { width, init: WATCH });
      const r = await pg.evaluate(() => {
        const vis = [...document.querySelectorAll("#cg-lines li")].filter((e) => e.offsetParent);
        const box = document.getElementById("cot-chart-box").getBoundingClientRect();
        return { lastLine: vis.at(-1).getBoundingClientRect().bottom + scrollY, box: box.top + scrollY, h: box.height, h0: window.__h0,
          ask: document.querySelector('#cot-glance [data-signup-ask]').getBoundingClientRect().top + scrollY,
          market: document.getElementById("cot-chart-box").dataset.market, latest: +document.getElementById("cot-chart-box").dataset.latest,
          pressed: document.querySelector('.cc-chip[aria-pressed="true"]').textContent, sw: document.documentElement.scrollWidth,
          cls: window.__cls.reduce((a, x) => a + x.v, 0) };
      });
      assert.ok(r.box > r.lastLine && r.box < r.ask, `under the lines and above the ask at ${width}: ${JSON.stringify(r)}`);
      if (width === 390) assert.ok(r.box < 844 + 120, `the chart's top is on the first screen or one short scroll down (${r.box}px)`);
      assert.equal(r.market, "corn");
      assert.equal(r.pressed, "Corn");
      assert.equal(r.latest, COT.corn.net, "the latest point is cot.json's corn net");
      assert.ok(Math.abs(r.h - r.h0) < 0.5, `the chart's box is held at first paint (${r.h0} then ${r.h}) at ${width}`);
      assert.equal(r.cls, 0, "no layout shift on the page while the lines and the chart fill in at " + width);
      assert.ok(r.sw <= width, "no sideways scroll at " + width);
      if (width === 390) {
        assert.equal(await pg.isVisible("#cg-more"), true, "the rest of the lines behind one tap on a phone");
        await pg.click("#cg-more");
        assert.equal(await pg.$$eval("#cg-lines li", (a) => a.filter((e) => e.offsetParent).length), G.ORDER.length);
      }
      await pg.context().close();
    }
  } finally { await browser.close(); srv.close(); }
});

test("/cot?m=soybeans opens on soybeans; a chip changes the market and the link; hover and keys show the week", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot?m=soybeans", { width: 1280 });
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "beans");
    assert.equal(+(await pg.$eval("#cot-chart-box", (b) => b.dataset.latest)), COT.beans.net);
    assert.equal((await pg.textContent("#cc-head")).trim(), "Funds are fairly heavily long soybeans and sold a net 27,544 contracts this week.");
    assert.equal((await pg.textContent("#cc-src")).trim(), "CFTC Commitments of Traders, managed money, futures only, as of Oct 27, released Oct 30. Price: front-month futures close each report Tuesday (Yahoo Finance), adjusted for contract rolls.");
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.price), "1");
    // hover: the week's date and net
    const plot = await pg.$("#cc-plot");
    await plot.scrollIntoViewIfNeeded();
    const bb = await plot.boundingBox();
    await pg.mouse.move(bb.x + bb.width - 14, bb.y + bb.height / 2);
    await pg.waitForSelector("#cc-tip:not([hidden])");
    assert.match(await pg.textContent("#cc-tip"), /^Oct 27, 2026Net 193,781 longFutures close \$12\.29¼\/bu$/);
    await plot.focus();
    await pg.keyboard.press("ArrowLeft");
    assert.match(await pg.textContent("#cc-tip"), /^Oct 20, 2026Net 221,325 long/);
    // a chip: hogs, no price strip, the link follows
    await pg.click('.cc-chip[data-k="leanhogs"]');
    assert.equal(new URL(pg.url()).searchParams.get("m"), "lean-hogs");
    assert.equal(+(await pg.$eval("#cot-chart-box", (b) => b.dataset.latest)), COT.leanhogs.net);
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.price), "0");
    assert.match(await pg.textContent("#cc-svg"), /No price line/);
    // an unknown market falls back to corn
    await pg.goto(`http://127.0.0.1:${port}/cot?m=bitcoin`);
    await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest);
    assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "corn");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("Share this chart: the phone's share sheet gets the market's link; a desktop copies it", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const stub = () => {
    window.__shared = []; window.__copied = [];
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: !!window.__coarse, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    Object.defineProperty(navigator, "share", { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
  };
  try {
    let pg = await open(browser, port, "/cot?m=soybeans", { init: () => { window.__coarse = true; }, touch: true });
    await pg.addInitScript(stub); await pg.reload(); await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest && /Funds are/.test(document.getElementById("cc-head").textContent));
    await pg.evaluate(() => { window.__coarse = true; });
    await pg.click("#cc-share");
    const shared = await pg.evaluate(() => window.__shared);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, "https://agsist.com/cot?m=soybeans");
    assert.equal(shared[0].text, "Funds are fairly heavily long soybeans and sold a net 27,544 contracts this week.");
    assert.match(shared[0].title, /soybeans/);
    await pg.context().close();

    pg = await open(browser, port, "/cot?m=chicago-wheat", { width: 1280 });
    await pg.addInitScript(stub); await pg.reload(); await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest);
    await pg.click("#cc-share");
    await pg.waitForFunction(() => document.getElementById("cc-note").textContent === "Link copied");
    assert.deepEqual(await pg.evaluate(() => [window.__shared.length, window.__copied]), [0, ["https://agsist.com/cot?m=chicago-wheat"]]);
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("Save image: a 1200x675 PNG with the headline, agsist.com/cot and the report date", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const pg = await open(browser, port, "/cot?m=soybeans", { width: 1280 });
    const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#cc-save")]);
    assert.equal(dl.suggestedFilename(), "agsist-cot-soybeans-2026-10-27.png");
    const buf = fs.readFileSync(await dl.path());
    assert.equal(buf.subarray(1, 4).toString(), "PNG");
    assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [1200, 675], "1200x675");
    const im = await pg.evaluate(() => window.AgCotChart.lastImage);
    assert.ok(im.texts.includes("agsist.com/cot"), "carries agsist.com/cot");
    assert.ok(im.texts.includes("Positions as of Oct 27, 2026, released Oct 30"), "carries the date: " + im.texts.join(" | "));
    assert.ok(im.texts.some((t) => t.startsWith("Funds are fairly heavily long soybeans")), "carries the headline");
    assert.ok(im.texts.includes("193,781 long"), "this week's number");
    assert.ok(im.texts.some((t) => /^Source: CFTC Commitments of Traders/.test(t)), "and its source");
    assert.ok(!im.texts.some((t) => DASH.test(t)), "no dashes");
    await pg.context().close();
  } finally { await browser.close(); srv.close(); }
});

test("home card: each line opens /cot on its market", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const own = { "/data/cot.json": fs.readFileSync(FIX.cot), "/data/cot-analysis.json": fs.readFileSync(FIX.cx) };
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.origin === `http://127.0.0.1:${port}`) return own[u.pathname] ? r.fulfill({ status: 200, contentType: "application/json", body: own[u.pathname] }) : r.continue();
      return r.abort();
    });
    await pg.clock.setFixedTime(new Date("2026-11-04T15:46:20Z"));
    await pg.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "load" });
    await pg.waitForFunction(() => document.querySelectorAll("#cot-glance a.cot-gl-a").length === 3);
    assert.deepEqual(await pg.$$eval("#cot-glance a.cot-gl-a", (a) => a.map((x) => x.getAttribute("href"))), ["/cot?m=corn", "/cot?m=soybeans", "/cot?m=chicago-wheat"]);
    await pg.evaluate(() => { let d = document.getElementById("cot-widget"); while (d) { if (d.tagName === "DETAILS") d.open = true; d = d.parentElement; } });
    const h = await pg.$$eval("#cot-glance a.cot-gl-a", (a) => a.map((x) => x.getBoundingClientRect().height));
    assert.ok(h.every((x) => x >= 44), "taps 44 px or more: " + h);
    await ctx.close();
  } finally { await browser.close(); srv.close(); }
});
