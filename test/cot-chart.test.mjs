/* The 52-week funds chart on /cot (2026-11-05, Sig: "I want the 52-week COT chart enhanced and made near the top
 * of the page ... I can picture people sharing it if we make it easy"). components/cot-chart.js.
 *   - one chart near the top (Nov 5, Sig: "KISS, the chart I want can tell a lot of that story"): the crowded
 *     verdict when it fits one line, the chips, one brief line for the market picked, the chart; every market
 *     in a table behind one "All markets" tap under it, then the email ask; on a 390 px phone the chart's
 *     line is on the first screen; no sentence repeats per market (no phrase over 4 words repeats across rows);
 *   - one market at a time, corn by default, the pick in the link (?m=soybeans); a table row picks it too;
 *   - the last point is cot.json's net for that market; the title is cot-glance.js brief();
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
test("the last point is cot.json's net, and the title is that market's brief line", () => {
  for (const k of G.ORDER) {
    const m = C.model(k, HIST, COT, CX);
    assert.ok(m, k);
    assert.equal(m.rows.length, 52, k + ": 52 weekly reports");
    assert.equal(m.last.net, COT[k].net, k + ": the latest point equals cot.json");
    assert.equal(m.last.date, "2026-10-27");
    assert.equal(m.headline, G.brief(k, COT, CX).text, k);
    assert.ok(m.headline.startsWith(G.SHORT[k] + ": funds "), m.headline);
    assert.equal(m.hi.net, Math.max(...m.rows.map((r) => r.net)), k + " high");
    assert.equal(m.lo.net, Math.min(...m.rows.map((r) => r.net)), k + " low");
    assert.equal(m.hi.net, COT[k].max52, k + ": the high agrees with the card's 52-wk range");
    assert.equal(m.lo.net, COT[k].min52, k + ": the low agrees with the card's 52-wk range");
    assert.ok(m.src.startsWith("CFTC Commitments of Traders, managed money, futures only, as of Oct 27, released Oct 30."), m.src);
    assert.ok(!DASH.test(m.src + m.headline + m.priceWhy), "no dashes");
  }
  assert.equal(C.model("beans", HIST, COT, CX).headline, "Soybeans: funds long, fairly heavy, sold 27,544 this week");
  assert.equal(C.model("mplswheat", HIST, COT, CX).headline, "MPLS wheat: funds short, moderate, sold 7,906 this week, flipped to short");
  assert.equal(C.model("soymeal", HIST, COT, CX).headline, "Soybean meal: funds long, heavy, crowded, sold 32,164 this week");
  assert.equal(C.model("kcwheat", HIST, COT, CX).headline, "KC wheat: funds about even, sold 8,007 this week");
});

test("no title is claimed when the chart's last week is not the report on the page, or the nets differ", () => {
  const next = { ...clone(COT), report_date: "November 3, 2026" };
  assert.equal(C.model("corn", HIST, next, CX).headline, null, "a different week: no title");
  const moved = clone(COT); moved.corn.net += 1;
  assert.equal(C.model("corn", HIST, moved, CX).headline, null, "a different net: no title");
  const m = C.model("corn", HIST, COT, null);
  assert.equal(m.headline, "Corn: funds long, sold 83,310 this week", "without the analysis: no weight word and no rank");
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

/* every run of 5 words (lower case, numbers kept) in a list of texts -> the runs found in more than one text */
function repeats(texts) {
  const seen = new Map();
  texts.forEach((t, i) => {
    const w = t.toLowerCase().replace(/[^a-z0-9,.'+\u2212 -]/g, " ").split(/\s+/).filter(Boolean);
    for (let j = 0; j + 5 <= w.length; j++) {
      const k = w.slice(j, j + 5).join(" ");
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(i);
    }
  });
  return [...seen].filter(([, s]) => s.size > 1).map(([k]) => k);
}

test("no phrase over 4 words repeats across the market rows (Sig, Nov 5: 'extremely repetitive wording')", () => {
  // the /cot table, the home rows and the brief lines every chip shows, for the frozen report and a few made-up weeks
  const weeks = [COT];
  for (const shift of [1, -1]) { const c = clone(COT); for (const k of G.ORDER) c[k].prev = c[k].net - shift * 1000; weeks.push(c); }
  for (const c of weeks) for (const cx of [CX, null]) {
    const rows = G.rows(c, cx).map((r) => [r.name, r.pos, r.rank, r.chg].join(" "));
    assert.equal(rows.length, G.ORDER.length);
    assert.deepEqual(repeats(rows), [], "table rows");
    const home = G.rows(c, cx, ["corn", "beans", "wheat"]).map((r) => [r.name, r.pos, r.chg].join(" "));
    assert.deepEqual(repeats(home), [], "home rows");
    for (const r of G.rows(c, cx)) assert.ok(r.pos.split(" ").length <= 3, "a short cell: " + r.pos);
  }
  // the test itself catches the old sentence per market
  assert.ok(repeats(G.lines(COT, CX).map((l) => l.text)).length > 0, "the old lines repeat (the check works)");
  // one brief line shows at a time, and it is short
  for (const k of G.ORDER) assert.ok(G.brief(k, COT, CX).text.length <= 100, G.brief(k, COT, CX).text);
  // the verdict is the short form of the one crowded verdict
  assert.equal(G.verdict(COT, CX), "Crowded: soybean meal long; lean hogs, Class III milk short");
  assert.equal(G.verdict(COT, null), null);
  assert.equal(G.asOfShort(COT, CX), "As of Tue, Oct 27, released Fri, Oct 30");
  const cot = read("cot.html");
  assert.ok(!/Funds are [a-z ]+ (long|short) /.test(cot.replace(/<!-- PRERENDER:cot-summary -->[\s\S]*?<!-- \/PRERENDER:cot-summary -->/, "")), "no sentence per market in the page");
});

test("/cot carries one chart, under the verdict and above the market table and the ask, and loads the bumped scripts", () => {
  const cot = read("cot.html");
  const v = cot.indexOf('id="cg-verdict"'), box = cot.indexOf('id="cot-chart-box"'), table = cot.indexOf('id="cg-all"'), ask = cot.indexOf('data-topic="cot"'), all = cot.indexOf('id="cot-all"');
  assert.ok(v > 0 && v < box && box < table && table < ask && ask < all, "verdict, chart, table, ask, details");
  assert.ok(!cot.includes('id="cg-lines"'), "no sentence per market");
  // the chips are in the page from the first paint, one per market, named as cot-glance.js names them
  const chips = [...cot.matchAll(/<button type="button" class="cc-chip" data-k="([a-z]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)];
  assert.deepEqual(chips.map((m) => m[1]), G.ORDER);
  assert.deepEqual(chips.map((m) => m[3]), G.ORDER.map((k) => G.SHORT[k]));
  assert.ok(!/<canvas id="cot-chart"|id="chart-tabs"|cot-chart-tab/.test(cot), "the old chart lower down is gone");
  assert.ok(!/drawChart|setActiveTab|cot-chart-tab/.test(read("components/cot-page.js")), "and its code");
  const i = (s) => cot.indexOf(`<script src="/components/${s}"></script>`);
  assert.ok(i("cot-glance.js?v=3") > 0 && i("cot-glance.js?v=3") < i("cot-chart.js?v=5") && i("cot-chart.js?v=5") < i("cot-page.js?v=8"));
  assert.match(cot, /\.cc-plot\{[^}]*height:300px/, "the plot's height is held before it draws");
  assert.match(cot, /\.cc-chip\{[^}]*min-height:44px/);
  assert.match(cot, /\.cc-btn\{[^}]*min-height:44px/);
  const js = read("components/cot-chart.js");
  assert.ok(!DASH.test(js.replace(/\/\*[\s\S]*?\*\//g, "")), "no dashes in the chart's words");
  // no new library: inline SVG and a canvas drawn by our own file, nothing loaded from another host
  assert.deepEqual([...cot.matchAll(/<script[^>]+src="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]).filter((x) => !/googletagmanager/.test(x)), [], "no outside script");
  assert.ok(Buffer.byteLength(js) < 50000, "the chart file stays small: " + Buffer.byteLength(js) + " bytes");
});

test("the home card's lines open /cot on their market", () => {
  assert.match(read("components/home.js"), /<a class="cot-gl-a" href="'\+G\.href\(r\.key\)\+'">/);
  assert.equal(G.href("beans"), "/cot?m=soybeans");
  for (const k of G.ORDER) assert.equal(G.keyOf(G.SLUG[k]), k);
  assert.equal(G.keyOf("nonsense"), null);
  const idx = read("index.html");
  for (const s of ["components/cot-glance.js?v=3", "components/home.js?v=24", "css/home.css?v=37"]) assert.ok(idx.includes("/" + s + '"'), s);
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
  await pg.waitForFunction(() => { const b = document.getElementById("cot-chart-box"); return b && b.dataset.latest && /: funds /.test(document.getElementById("cc-head").textContent); });
  return pg;
}
/* records the chart box's height at first paint, and every layout shift */
const WATCH = () => {
  window.__cls = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls.push({ v: e.value, in: e.sources.some((s) => s.node && s.node.closest && s.node.closest("#cot-chart-box")) }); }).observe({ type: "layout-shift", buffered: true });
  document.addEventListener("DOMContentLoaded", () => { const b = document.getElementById("cot-chart-box"); window.__h0 = b ? b.getBoundingClientRect().height : -1; });
};

test("/cot: the chart sits on the first screen, corn by default, its box held from first paint, no layout shift", { skip, timeout: 120000 }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const width of [390, 1280]) {
      const pg = await open(browser, port, "/cot", { width, init: WATCH });
      const r = await pg.evaluate(() => {
        const box = document.getElementById("cot-chart-box").getBoundingClientRect();
        return { verdict: document.getElementById("cg-verdict").getBoundingClientRect().bottom + scrollY, box: box.top + scrollY, h: box.height, h0: window.__h0,
          head: document.getElementById("cc-head").getBoundingClientRect().bottom + scrollY,
          ask: document.querySelector('#cot-glance [data-signup-ask]').getBoundingClientRect().top + scrollY,
          market: document.getElementById("cot-chart-box").dataset.market, latest: +document.getElementById("cot-chart-box").dataset.latest,
          pressed: document.querySelector('.cc-chip[aria-pressed="true"]').textContent, sw: document.documentElement.scrollWidth,
          cls: window.__cls.reduce((a, x) => a + x.v, 0) };
      });
      assert.ok(r.box > r.verdict && r.box < r.ask, `under the verdict and above the ask at ${width}: ${JSON.stringify(r)}`);
      assert.ok(r.head < 844, `the chips and the brief line are on the first screen (${r.head}px) at ${width}`);
      assert.equal(r.market, "corn");
      assert.equal(r.pressed, "Corn");
      assert.equal(r.latest, COT.corn.net, "the latest point is cot.json's corn net");
      assert.ok(Math.abs(r.h - r.h0) < 0.5, `the chart's box is held at first paint (${r.h0} then ${r.h}) at ${width}`);
      assert.equal(r.cls, 0, "no layout shift on the page while the verdict and the chart fill in at " + width);
      assert.ok(r.sw <= width, "no sideways scroll at " + width);
      // every market behind one tap; a row picks the chart's market
      await pg.click("#cg-all > summary");
      assert.equal(await pg.$$eval("#cg-rows tr", (a) => a.filter((e) => e.offsetParent).length), G.ORDER.length);
      const fit = await pg.$eval(".cg-table", (t) => ({ sw: t.scrollWidth, cw: t.parentElement.clientWidth, fs: Math.min(...[...t.querySelectorAll("td,th")].map((c) => parseFloat(getComputedStyle(c).fontSize))), h: Math.max(...[...t.querySelectorAll("tbody td")].map((c) => c.getBoundingClientRect().height)) }));
      assert.ok(fit.sw <= fit.cw && fit.fs >= 12, `four columns fit without a sideways scroll, text 12 px or more at ${width}: ${JSON.stringify(fit)}`);
      await pg.click('#cg-rows .cg-pick[data-k="milk"]');
      assert.equal(await pg.$eval("#cot-chart-box", (b) => b.dataset.market), "milk");
      assert.equal(new URL(pg.url()).searchParams.get("m"), "milk");
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
    assert.equal((await pg.textContent("#cc-head")).trim(), "Soybeans: funds long, fairly heavy, sold 27,544 this week");
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
    await pg.addInitScript(stub); await pg.reload(); await pg.waitForFunction(() => document.getElementById("cot-chart-box").dataset.latest && /: funds /.test(document.getElementById("cc-head").textContent));
    await pg.evaluate(() => { window.__coarse = true; });
    await pg.click("#cc-share");
    const shared = await pg.evaluate(() => window.__shared);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, "https://agsist.com/cot?m=soybeans");
    assert.equal(shared[0].text, "Soybeans: funds long, fairly heavy, sold 27,544 this week");
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
    assert.ok(im.texts.some((t) => t.startsWith("Soybeans: funds long, fairly heavy")), "carries the headline");
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
