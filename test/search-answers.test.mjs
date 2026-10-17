/* What people searched for, answered on the first screen (2026-10-17 search-terms check:
 * Google Search Console, Bing keywords and Bing AI grounding queries against each page's
 * first screen at 390 and 1280).
 *
 *   /cash-bids              companies named (only ones with a page), "my elevator" answer from
 *                           data/elevator-counts.json, a no-ZIP middle bid (components/cb-sample.js)
 *   /cattle-futures-prices  feeder cattle a headline price beside live cattle, same size, own stamp
 *   /cattle-auction-prices  a no-ZIP first line from the USDA state summaries already loaded
 *   /hail-map               a FAQ that says report counts follow population, not risk
 *   /rent/                  a state picker for county rates, a cropland/pasture switch on the map
 *   soybean page            the corn line, from the same quote the corn page leads with
 *
 * Hand-worked: Iowa corn median basis -0.40 on ZCZ26, Dec '26 settled 474.25 cents.
 * 474.25 - 40 = 434.25 cents -> about $4.34. Soybeans -0.65 on ZSX26 at 1261.25:
 * 1261.25 - 65 = 1196.25 -> $11.96.
 *
 *   node --test test/search-answers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(ROOT + p, "utf8");
const PX = require(ROOT + "components/price-local.js");
const CBS = require(ROOT + "components/cb-sample.js");
const DASH = /—/;

/* ---------------- /cash-bids ---------------- */
const CB = read("cash-bids.html");

test("cash-bids: the companies line names only companies with a page, never Cargill", () => {
  const m = /<!--CO-LINE-->(.*?)<!--\/CO-LINE-->/s.exec(CB);
  assert.ok(m && m[1].length > 40, "companies line is baked");
  const links = [...m[1].matchAll(/href="(\/cash-bids\/company\/[^"]*)"/g)].map((x) => x[1]);
  assert.ok(links.includes("/cash-bids/company/"), "links the company list");
  for (const l of links.filter((x) => !x.endsWith("/"))) assert.ok(existsSync(ROOT + l.slice(1) + ".html"), l + " has a page");
  assert.ok(!/cargill/i.test(m[1]));
  assert.ok(CB.indexOf("<!--CO-LINE-->") < CB.indexOf('id="cb-zip"'), "above the ZIP box");
  const n = (read("cash-bids/company/index.html").match(/<tr><td class="l"><a href=/g) || []).length;
  const more = /and ([\d,]+) more elevator compan/.exec(m[1]);
  assert.equal(Number(more[1].replace(/,/g, "")) + links.length - 1, n, "named + more = every company page");
});

test("cash-bids: 'Do you show my elevator's bids?' carries the counts file's numbers, visible and in JSON-LD", () => {
  const c = JSON.parse(read("data/elevator-counts.json"));
  const f = /<!--CO-FAQ-->(.*?)<!--\/CO-FAQ-->/s.exec(CB)[1];
  const fmt = (x) => x.toLocaleString("en-US");
  for (const v of [c.coverage.read, c.coverage.elevators, c.bids.elevators, c.bids.towns]) assert.ok(f.includes(fmt(v)), fmt(v));
  assert.match(f, /href="\/list-your-elevator"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(CB)[1]);
  const q = ld["@graph"].find((g) => g["@type"] === "FAQPage").mainEntity.filter((x) => x.name === "Do you show my elevator’s bids?");
  assert.equal(q.length, 1);
  assert.ok(q[0].acceptedAnswer.text.includes(fmt(c.bids.elevators)));
  assert.ok(!DASH.test(f) && !DASH.test(q[0].acceptedAnswer.text));
});

test("cash-bids: the no-ZIP sample is deferred, loads nothing up front, and does the arithmetic", () => {
  assert.match(CB, /<script src="\/components\/cb-sample\.js\?v=\d+" defer><\/script>/);
  assert.ok(!/price-local\.js/.test(CB), "price-local.js is loaded only when the sample is needed");
  const js = read("components/cb-sample.js");
  assert.match(js, /price-local\.js\?v=3/);
  const now = Date.parse("2026-10-17T20:00:00Z");
  const bs = { generated: "2026-10-17T19:37:08Z", min_n: 3, states: {
    IA: { name: "Iowa", path: "/cash-bids/iowa/#basis", elevators: 348, crops: {
      corn: { contract: "ZCZ26", label: "Dec '26", n: 274, median: -0.4 }, soybeans: { contract: "ZSX26", label: "Nov '26", n: 234, median: -0.65 } } },
    MO: { name: "Missouri", path: "/cash-bids/missouri/#basis", elevators: 28, crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 2, median: -0.3 } } } } };
  const prices = { fetched: "2026-10-17T06:46:21Z", quotes: {
    a: { ticker: "ZCZ26.CBT", close: 474.25, close_kind: "settle", close_date: "2026-10-16", settle_date: "2026-10-16" },
    b: { ticker: "ZSX26.CBT", close: 1261.25, close_kind: "settle", close_date: "2026-10-16", settle_date: "2026-10-16" } } };
  const h = CBS.render(bs, prices, PX.cell, now);
  assert.match(h, /\$4\.34/);
  assert.match(h, /\$11\.96/);
  assert.match(h, /40¢ under/);
  assert.match(h, /Oct 16 settle/);
  assert.ok(!/Missouri/.test(h), "two elevators is too few for a middle");
  // no quote: the basis alone, never a cash price
  const h2 = CBS.render(bs, { quotes: {} }, PX.cell, now);
  assert.ok(!/\$4\./.test(h2) && /40¢ under/.test(h2), h2);
  // a basis file older than ten days: nothing
  assert.equal(CBS.render(bs, prices, PX.cell, Date.parse("2026-10-30T00:00:00Z")), "");
  // the state line on the futures pages says the same number
  assert.match(PX.lines(bs, prices, "IA", ["corn"], now)[0], /about <b>\$4\.34<\/b>/);
});

/* ---------------- /cattle-futures-prices ---------------- */
test("cattle futures: feeder cattle is a headline price beside live cattle, same size, own stamp", () => {
  const h = read("cattle-futures-prices.html");
  const hero = h.slice(h.indexOf('<div class="ph">'), h.indexOf('<p class="ct-seednote">'));
  assert.match(hero, /<h1><!--BAKE:cattle-h1-->Feeder and live cattle futures prices today<!--\/BAKE--><\/h1>/);
  const gf = hero.indexOf('id="hero-gf-price"'), le = hero.indexOf('id="hero-price"');
  assert.ok(gf > 0 && le > gf, "feeder first, then live");
  assert.match(hero, /<div class="ph-val sk" id="hero-gf-price"><!--SEED:gfpx-->\$\d{3}\.\d+<!--\/SEED--><\/div>/);
  assert.match(hero, /<div class="ph-val sk" id="hero-price"><!--SEED:px-->\$\d{3}\.\d+<!--\/SEED--><\/div>/);
  assert.match(hero, /id="hero-gf-stamp"><!--SEED:gfstamp-->/);
  assert.match(hero, /id="hero-le-stamp"><!--SEED:lestamp-->/);
  assert.match(h, /heroQ\(gf,'hero-gf-price','hero-gf-chg','hero-gf-stamp','hero-gf-ct'\)/);
  assert.match(h, /AgPxStamp\.html\(q,d\.fetched\)/, "the same settle / last-trade words as the status line");
  assert.ok(!/Feeder Cattle Index/i.test(hero), "no index value without index data");
  assert.equal(PX.label("GFV26.CME"), "Oct '26");
});

/* ---------------- soybean page: corn line ---------------- */
test("soybean page: the corn line is seeded and refreshed from the corn page's quote", () => {
  const h = read("soybean-futures-prices.html");
  assert.match(h, /<!--SEED:cornline--><div class="nc-line" id="corn-line"[^>]*>/);
  assert.match(h, /<h1><!--BAKE:futures-h1-->CBOT soybean futures prices today, per bushel<!--\/BAKE--><\/h1>/);
  assert.match(read("corn-futures-prices.html"), /<h1><!--BAKE:futures-h1-->CBOT corn futures prices today, per bushel<!--\/BAKE--><\/h1>/);
  const f = read("components/futures.js");
  assert.match(f, /getElementById\('corn-line'\),cq=\(q\['corn-nearby'\]&&q\['corn-nearby'\]\.close!=null\)\?q\['corn-nearby'\]:q\.corn/);
});

/* ---------------- /cattle-auction-prices ---------------- */
test("cattle auction: the no-ZIP line is the biggest fresh state summaries, 500 and 700 lb classes", () => {
  const ctx = {};
  vm.runInNewContext(read("components/cattle-auction.js"), ctx);
  const A = ctx.AgSaleBarn;
  const cls = (cwt) => ({ head: 50, avg_wt: 550, cwt, per_head: cwt * 5.5, lo: cwt - 10, hi: cwt + 10, rows: 1 });
  const st = (state, date, receipts, classes) => ({ state, id: state.toLowerCase() + "-weekly", source_url: "u", sales: [{ date, receipts, classes }] });
  const states = [
    st("MO", "2026-10-11", 26800, { "steers|1": { 300: cls(503.77), 400: cls(452.73) } }),
    st("SD", "2026-10-12", 27681, { "steers|1": { 400: cls(500), 500: cls(466.6), 600: cls(420), 700: cls(398.56) } }),
    st("KY", "2026-10-13", 16315, { "steers|1-2": { 500: cls(400) } }),
    st("TX", "2026-09-20", 99999, { "steers|1": { 500: cls(300) } }),      // 27 days old: out
    st("WY", "2026-10-13", 14464, { "steers|1": { 500: cls(452.59), 700: cls(377.06) } }),
    st("AL", "2026-10-16", 8685, { "steers|1": { 500: cls(350) } }),
  ];
  const g = JSON.parse(JSON.stringify(A.glance(states, "steers|1", "2026-10-17")));   // out of the vm realm
  assert.deepEqual(g.map((x) => x.state), ["SD", "MO", "WY"], "receipts order, stale and wrong-grade left out");
  assert.deepEqual(g[0].cells.map((c) => [c.cls, c.cwt]), [[500, 466.6], [700, 398.56]]);
  assert.deepEqual(g[1].cells.map((c) => c.cls), [300, 400], "no 500/700: the two lightest the report has");
  assert.equal(A.glance([], "steers|1", "2026-10-17").length, 0);
  const page = read("cattle-auction-prices.html");
  assert.ok(page.indexOf('id="sb-glance"') < page.indexOf('id="sb-zip"'), "above the ZIP box");
  assert.match(page, /cattle-auction\.js\?v=4/);
});

/* ---------------- /hail-map ---------------- */
test("hail map: a FAQ says report counts follow population and the heatmap is not a risk map", () => {
  const h = read("hail-map.html");
  const q = "Is this a hail risk map?";
  const vis = new RegExp("<summary>" + q.replace("?", "\\?") + "</summary>\\s*<p>(.*?)</p>", "s").exec(h);
  assert.ok(vis, "visible FAQ");
  assert.match(vis[1], /^No\./);
  assert.match(vis[1], /follow population/);
  assert.match(vis[1], /href="#hm-states-h"/);
  assert.ok(h.includes('id="hm-states-h"'));
  const ld = JSON.parse(/<script type="application\/ld\+json">\s*(\{"@context": "https:\/\/schema.org", "@type": "FAQPage".*?)<\/script>/s.exec(h)[1]);
  assert.equal(ld.mainEntity.filter((x) => x.name === q).length, 1);
  assert.ok(!DASH.test(vis[1]));
});

/* ---------------- /rent/ ---------------- */
test("rent hub: a state picker for county rates on top, and pasture on the map", () => {
  const h = read("rent/index.html");
  const f = /<form class="rh-find"[\s\S]*?<\/form>/.exec(h)[0];
  const opts = [...f.matchAll(/<option value="(\/rent\/[a-z-]+)">/g)].map((x) => x[1]);
  const n = Number(/(\d+) states &middot;/.exec(h)[1]);
  assert.equal(opts.length, n);
  for (const o of opts) assert.ok(existsSync(ROOT + o.slice(1) + ".html"), o);
  assert.ok(h.indexOf('class="rh-find"') < h.indexOf('class="rh-grid"'), "picker before the map");
  const tiles = [...h.matchAll(/<a class="rh-tile"[^>]*>/g)].map((x) => x[0]);
  assert.ok(tiles.length === n && tiles.every((t) => /data-pv="(\$[\d,.]+|n\/a)"/.test(t)));
  // Iowa's pasture tile is the Pasture column's Iowa median, to the dollar
  const ia = /<td><a href="\/rent\/iowa" >Iowa<\/a><\/td>(?:<td[^>]*>[^<]*<\/td>){4}<td data-v="([\d.]+)">/.exec(h);
  assert.ok(ia, "Iowa pasture cell");
  const tile = /<a class="rh-tile" href="\/rent\/iowa"[^>]*data-pv="\$([\d,.]+)"/.exec(h)[1];
  const v = Number(ia[1]);   // 65.25 on the 2026 file -> "$65" (a 64px tile; the table keeps cents)
  assert.equal(tile, v >= 10 ? String(Math.round(v)) : v.toFixed(2));
  assert.match(h, /<button type="button" aria-pressed="false" data-rh="p">Pasture<\/button>/);
});

/* ---------------- browser: 390 and 1280, no sideways scroll, no script errors ---------------- */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

test("the six pages at 390 and 1280: no horizontal scroll, no page errors, the new lines render", { skip, timeout: 120000 }, async () => {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let f = normalize(join(ROOT, p));
    if (!p.endsWith("/") && existsSync(f + ".html")) f += ".html";
    else if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const want = {
    "/cash-bids": "#cb-sample .cbs-t tbody tr",
    "/cattle-futures-prices": "#hero-gf-stamp .px-stamp",
    "/cattle-auction-prices": "#sb-glance li",
    "/hail-map": "#hm-faq-h",
    "/rent/": ".rh-find select",
    "/soybean-futures-prices": "#corn-line strong",
  };
  try {
    for (const w of [390, 1280]) {
      const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: w === 390 ? 844 : 800 } });
      await ctx.route("**/*", (r) => (r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort()));
      for (const [p, sel] of Object.entries(want)) {
        const pg = await ctx.newPage(), errs = [];
        pg.on("pageerror", (e) => errs.push(e.message));
        await pg.goto(`http://127.0.0.1:${port}${p}`, { waitUntil: "load" });
        await pg.waitForSelector(sel, { state: "attached", timeout: 8000 });
        const [sw, iw] = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        assert.ok(sw <= iw, `${p} at ${w}: scrollWidth ${sw} > ${iw}`);
        assert.deepEqual(errs, [], `${p} at ${w}`);
        await pg.close();
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
