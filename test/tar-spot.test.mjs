/* /tar-spot (2026-11-05): the tar spot hub and its spray break-even calculator.
 *
 * The math (components/tar-spot.js calc) against hand-worked answers; the page
 * links no outside source (Oct 29: sources named in plain text, with dates);
 * the FAQ structured data says only what the page says; the sitemap, tools page
 * and llms.txt list it; and in a browser, at 390 and 1280 wide, the page draws
 * with every outside host refused, no sideways scroll, and the calculator gives
 * 8.0 bu/A for a $32 pass at $4 corn.
 * Browser checks need Playwright and Chromium (PLAYWRIGHT_PATH, CHROMIUM_PATH). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const page = read("tar-spot.html");
const T = createRequire(import.meta.url)(join(ROOT, "components/tar-spot.js"));

/* ---------------- the arithmetic ---------------- */

test("break-even: $20 product + $12 application at $4 corn is 8 bu/A, arithmetic shown", () => {
  const o = { product: 20, app: 12, price: 4 };
  const r = T.calc(o);
  assert.equal(r.cost, 32);
  assert.equal(r.breakEven, 8);
  assert.equal(r.need, 8);
  assert.equal(r.risk, null);
  assert.equal(T.mathLine(o, r), "($20.00 + $12.00) / $4.00 a bushel = 8.0 bu/A");
});

test("break-even: hand-worked cases", () => {
  const cases = [
    // product, app, price, damage -> need
    [[32, null, 4, null], 8],
    [[25, 15, 5, null], 8],
    [[18.5, 9.5, 3.5, null], 8],
    [[40, 0, 4.5, null], 8.889],
    [[20, 12, 4, 1.5], 9.5],          // 8 for the cost, 1.5 knocked down by the trip
    [[null, 12, 4, null], 3],
  ];
  for (const [[product, app, price, damage], want] of cases) {
    const r = T.calc({ product, app, price, damage });
    assert.ok(Math.abs(r.need - want) < 0.001, `${product}+${app} at ${price}, damage ${damage}: ${r.need} not ${want}`);
  }
  const d = T.calc({ product: 20, app: 12, price: 4, damage: 1.5 });
  assert.equal(T.mathLine({ product: 20, app: 12, price: 4 }, d), "($20.00 + $12.00) / $4.00 a bushel = 8.0 bu/A, plus 1.5 bu/A lost to the trip = 9.5 bu/A");
});

test("second pass: its own cost only, judged above one pass", () => {
  const r = T.calc({ product: 22, app: 13, price: 5, second: true });
  assert.equal(r.second, true);
  assert.equal(r.breakEven, 7);
  const src = read("components/tar-spot.js");
  assert.match(src, /has to add ' \+ bu\(res\.need\) \+ ' bushels an acre above what one pass already saves\. Compare it with one pass, not with untreated corn\./);
});

test("the risk line uses only the reader's own guesses", () => {
  // 50% odds of saving 16 bu/A at $4 = 8 bu/A on average = $32 against $32: even
  const r = T.calc({ product: 20, app: 12, price: 4, odds: 50, saved: 16 });
  assert.equal(r.risk.expectedBu, 8);
  assert.equal(r.risk.gross, 32);
  assert.equal(r.risk.net, 0);
  const r2 = T.calc({ product: 20, app: 12, price: 4, odds: 25, saved: 16, damage: 1 });
  assert.equal(r2.risk.expectedBu, 4);
  assert.equal(r2.risk.net, (4 - 1) * 4 - 32);
  assert.equal(T.calc({ product: 20, app: 12, price: 4, odds: 50 }).risk, null, "no bushels guess, no risk line");
  assert.equal(T.calc({ product: 20, app: 12, price: 4, odds: 150, saved: 10 }).risk, null, "odds over 100 refused");
});

test("nothing is made up: no cost or no price gives no answer", () => {
  assert.equal(T.calc({ price: 4 }), null);
  assert.equal(T.calc({ product: 20, app: 12 }), null);
  assert.equal(T.calc({ product: 20, app: 12, price: 0 }), null);
  assert.equal(T.calc(null), null);
  // the inputs start empty: no cost is filled in for the reader
  for (const id of ["ts-product", "ts-app", "ts-damage", "ts-odds", "ts-saved"]) {
    const m = page.match(new RegExp(`<input id="${id}"[^>]*>`));
    assert.ok(m, id);
    assert.ok(!/\svalue=/.test(m[0]), `${id} has no preset value`);
  }
});

test("the break-even table on the page is cost / price", () => {
  const t = page.match(/<caption class="sr-only">Bushels an acre to break even[\s\S]*?<\/table>/)[0];
  const prices = [3.5, 4, 4.5, 5];
  const rows = [...t.matchAll(/<tr><th scope="row">\$(\d+) an acre<\/th>((?:<td>[^<]+<\/td>)+)<\/tr>/g)];
  assert.equal(rows.length, 5);
  for (const [, cost, cells] of rows) {
    const v = [...cells.matchAll(/<td>([^<]+)<\/td>/g)].map((m) => m[1]);
    assert.deepEqual(v, prices.map((p) => (Number(cost) / p).toFixed(1)), `$${cost}`);
  }
  assert.match(page, /\$32 an acre pass at \$4 corn needs 8 bushels an acre/);
});

/* ---------------- the page ---------------- */

test("no outbound links: sources are named in plain text with dates", () => {
  const body = page.slice(page.indexOf("<body"));
  const hrefs = [...body.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 5);
  for (const h of hrefs) assert.ok(/^(\/|#)/.test(h), `outside link on the page: ${h}`);
  const scripts = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) assert.ok(s.startsWith("/components/"), `outside script: ${s}`);
  const srcs = page.match(/<h2 id="sources">Sources<\/h2>[\s\S]*?<\/ul>/)[0];
  const items = [...srcs.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  assert.ok(items.length >= 15);
  for (const li of items) assert.match(li, /\b(19|20)\d\d\b|our basis page/, `a source without a date: ${li}`);
});

test("every section has its anchor and the numbers carry their source and year", () => {
  for (const id of ["now", "identify", "scout", "weather", "spray", "calc", "products", "harvest", "myths", "questions", "sources"]) {
    assert.match(page, new RegExp(`id="${id}"`), id);
    assert.match(page, new RegExp(`href="#${id}"|id="${id}"[^>]*>`), id);
  }
  assert.match(page, /231 million bushels in 2021<\/b>, <b>38 million in 2023<\/b> and <b>293 million in 2024<\/b> \(Crop Protection Network loss estimates/);
  assert.match(page, /The current edition is <b>February 2026<\/b> \(Crop Protection Network, Fungicide Efficacy for Control of Corn Foliar Diseases\)/);
  assert.match(page, /588 field observations in eight states from 2018 to 2022/);
  assert.match(page, /the scrape test is not definitive/);
  assert.match(page, /Crop Disease Forecasting/);
  // the ratings are disease control, never profit, and no product is promised a response
  assert.match(page, /The ratings are about disease control, not bushels or profit/);
  const said = page.replace(/<script[\s\S]*?<\/script>/g, "").split(/(?<=\.)\s/).filter((x) => !/not a promise/.test(x)).join(" ");
  assert.ok(!/will (save|pay|return)/i.test(said), "no promised response");
});

test("copy rules: no em or en dashes, no mycotoxin claim, byline", () => {
  assert.ok(!/[–—]|&mdash;|&ndash;/.test(page), "dash");
  assert.ok(!/[–—]/.test(read("components/tar-spot.js")), "dash in the script");
  assert.match(page, /Do not assume tar spot makes a mycotoxin/);
  assert.match(page, /Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>/);
  assert.match(page, /"jobTitle": "Certified Crop Adviser \(CCA\)"/);
});

test("structured data is valid and the FAQ says only what the page says", () => {
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const ld = JSON.parse(blocks[0][1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.length >= 5);
  const shown = [...page.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)].map((m) => [m[1], m[2]]);
  const unesc = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  assert.deepEqual(faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]), shown.map(([q, a]) => [unesc(q), unesc(a)]));
  const art = ld["@graph"].find((x) => x["@type"] === "Article");
  assert.equal(art.url, "https://agsist.com/tar-spot");
  assert.equal(art.author.name, "Sigurd Lindquist");
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/tar-spot">/);
  assert.match(page, /<title>[^<]*[Tt]ar spot[^<]*\| AGSIST<\/title>/);
});

test("listed in the sitemap, the tools page and llms.txt; daily ask at the end", () => {
  assert.match(read("sitemap.xml"), /<loc>https:\/\/agsist\.com\/tar-spot<\/loc>/);
  assert.match(read("tools.html"), /<a href="\/tar-spot" class="tool-card"/);
  assert.match(read("llms.txt"), /\(https:\/\/agsist\.com\/tar-spot\)/);
  assert.match(read("scripts/build_llms_txt.py"), /"\/tar-spot"/);
  const ask = page.indexOf("data-signup-ask=");
  assert.ok(ask > page.indexOf('id="questions"') && ask < page.indexOf('id="sources"'), "the Daily ask sits after the questions");
  assert.match(page, /data-source="page:tar-spot"/);
});

/* ---------------- in the browser ---------------- */

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (!extname(p)) p += ".html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

// frozen price files (build rule 50): $4.00 December futures for any crop year, Iowa basis -40 cents
const quotes = {};
for (let y = 24; y <= 40; y++) quotes[`corn-dec${y}`] = { ticker: `ZCZ${y}.CBT`, close: 400, close_date: "2026-11-05", close_kind: "settle" };
const PRICES = { fetched: "2026-11-05T21:00:00Z", quotes };
const BASIS = { generated: "2026-11-05T14:17:27Z", states: { IA: { name: "Iowa", crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 361, companies: 53, median: -0.4 } } } } };

test("browser: renders at 390 and 1280 with no outside requests; calculator answers", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  const shots = process.env.TARSPOT_SHOTS || join(tmpdir(), "tar-spot-shots");
  mkdirSync(shots, { recursive: true });
  try {
    const port = srv.address().port, local = `http://127.0.0.1:${port}`;
    for (const width of [390, 1280]) {
      const bctx = await browser.newContext({ serviceWorkers: "block", viewport: { width, height: 900 } });
      const pg = await bctx.newPage();
      const errors = [], outside = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.route("**/*", async (r) => {
        const u = r.request().url(), h = { "access-control-allow-origin": "*" };
        if (!u.startsWith(local)) { outside.push(u); return r.abort(); }
        if (u.includes("/data/prices.json")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(PRICES) });
        if (u.includes("/data/basis-states.json")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(BASIS) });
        return r.continue();
      });
      await pg.goto(`${local}/tar-spot`);
      await pg.waitForSelector("#ts-verdict");
      // the futures price fills in, labeled as futures
      await pg.waitForFunction(() => document.getElementById("ts-price").value === "4.00");
      assert.match(await pg.textContent("#ts-pricesrc"), /December \d{4} corn futures, CBOT, settle Nov 5, 2026\. That is a futures price, before your basis\./);
      await pg.fill("#ts-product", "20");
      await pg.fill("#ts-app", "12");
      await pg.waitForFunction(() => document.getElementById("ts-verdict").textContent === "8.0 bu/A to break even");
      assert.equal(await pg.textContent("#ts-math"), "($20.00 + $12.00) / $4.00 a bushel = 8.0 bu/A");
      // second pass: same arithmetic, against one pass
      await pg.click('[data-mode="second"]');
      assert.match(await pg.textContent("#ts-sub"), /above what one pass already saves\. Compare it with one pass, not with untreated corn\./);
      await pg.click('[data-mode="one"]');
      // a state: futures less the state's median basis, labeled an estimate
      await pg.selectOption("#ts-state", "IA");
      await pg.waitForFunction(() => document.getElementById("ts-price").value === "3.60");
      assert.match(await pg.textContent("#ts-pricesrc"), /State cash estimate, not a posted bid: Dec '26 corn futures \$4\.00 \(Nov 5, 2026\) less the Iowa basis of 40 cents, median of 361 elevators, 53 companies/);
      await pg.waitForFunction(() => document.getElementById("ts-verdict").textContent === "8.9 bu/A to break even");
      // the reader's own price wins and stays
      await pg.fill("#ts-price", "5");
      await pg.waitForFunction(() => document.getElementById("ts-verdict").textContent === "6.4 bu/A to break even");
      assert.equal(await pg.textContent("#ts-pricesrc"), "Your price.");
      // no sideways scroll
      const wide = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(wide <= 0, `${width}: page scrolls sideways by ${wide}px`);
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.screenshot({ path: join(shots, `tar-spot-${width}.png`), fullPage: false });
      await pg.locator("#calc").screenshot({ path: join(shots, `tar-spot-calc-${width}.png`) });
      assert.deepEqual(errors, [], `${width}: page errors`);
      // nothing leaves the local copy: every outside request was refused above, and the only one asked
      // for is the site-wide loader's own location lookup (components/loader.js), not this page's
      assert.deepEqual(outside.filter((u) => !/^https:\/\/agsist-api\.dnilgis\.workers\.dev\/where$/.test(u)), [], `${width}: outside requests`);
      await bctx.close();
    }
  } finally { await browser.close(); srv.close(); }
});
