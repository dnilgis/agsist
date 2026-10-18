/* Combine loss (components/combine-loss.js, combine-loss-ui.js) and the
 * /combine-loss page.
 *
 * The shipped files run here. Each worked example is a source's own example
 * (Nebraska CropWatch 2023, Iowa State ICM 2010, UW Extension) or the
 * arithmetic written out beside it, so a reader can redo it by hand.
 * Browser checks need Playwright and Chromium and skip without them.
 *
 *   node --test test/combine-loss.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/combine-loss.js", "utf8"), ctx);
const L = ctx.AgCombineLoss;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "combine-loss.html", "utf8");
const ui = readFileSync(ROOT + "components/combine-loss-ui.js", "utf8");
const math = readFileSync(ROOT + "components/combine-loss.js", "utf8");

/* ---------------- hand-worked examples ---------------- */

test("CropWatch example: 7 medium beans in 1 sq ft / 4 = 1.75 bu/ac", () => {
  const o = L.loss({ crop: "soybeans", behind: [7], area: 1, size: "medium" });
  near(o.lostBu, 1.75, 1e-12, "bu/ac");
});

test("bean size: small 5, medium 4, large 3 a sq ft; 40 medium beans in 10 sq ft is 1 bu/ac", () => {
  assert.equal(L.rule({ crop: "soybeans", size: "small" }), 5);
  assert.equal(L.rule({ crop: "soybeans", size: "medium" }), 4);
  assert.equal(L.rule({ crop: "soybeans", size: "large" }), 3);
  assert.equal(L.rule({ crop: "soybeans" }), 4, "medium is the default");
  near(L.loss({ crop: "soybeans", behind: [40], area: 10 }).lostBu, 1, 1e-12, "40 / 10 / 4");
  near(L.loss({ crop: "soybeans", behind: [40], area: 10, size: "small" }).lostBu, 0.8, 1e-12, "40 / 10 / 5");
  near(L.loss({ crop: "soybeans", behind: [40], area: 10, size: "large" }).lostBu, 4 / 3, 1e-12, "40 / 10 / 3");
});

test("seeds a pound: 4 a sq ft is 2,904 seeds/lb, and back", () => {
  // 4 x 43,560 / 60 = 2,904. 5 -> 3,630. 3 -> 2,178.
  assert.equal(L.seedsFromPerSqFt(4, 60), 2904);
  assert.equal(L.seedsFromPerSqFt(5, 60), 3630);
  assert.equal(L.seedsFromPerSqFt(3, 60), 2178);
  near(L.perSqFtFromSeeds(2904, 60), 4, 1e-12, "back to 4");
  // 3,000 seeds/lb: 3,000 x 60 / 43,560 = 4.132 a sq ft; 41 beans in 10 sq ft = 0.992 bu/ac
  near(L.loss({ crop: "soybeans", behind: [41], area: 10, seedsPerLb: 3000 }).lostBu, 41 / 10 / (3000 * 60 / 43560), 1e-12, "custom");
});

test("corn: 2 kernels a sq ft = 1 bu/ac; 20 in a 10 sq ft frame", () => {
  assert.equal(L.rule({ crop: "corn", size: "small" }), 2, "no size adjustment for corn");
  near(L.loss({ crop: "corn", behind: [20], area: 10 }).lostBu, 1, 1e-12, "20 kernels");
  near(L.loss({ crop: "corn", behind: [2], area: 1 }).lostBu, 1, 1e-12, "2 kernels in 1 sq ft");
});

test("ears: one 3/4 lb ear in 1/100 acre = 1 bu/ac; a 1/2 lb ear 2/3", () => {
  near(L.earsBu(1, 0.75), 1, 1e-12, "3/4 lb");
  near(L.earsBu(1, 0.5), 2 / 3, 1e-12, "1/2 lb");
  near(L.earsBu(3), 3, 1e-12, "default ear");
  // ears add to loose kernels: 20 kernels in 10 sq ft (1 bu) + 2 ears (2 bu) = 3 bu/ac
  near(L.loss({ crop: "corn", behind: [20], area: 10, ears: 2 }).lostBu, 3, 1e-12, "kernels + ears");
  // ears count only for corn
  near(L.loss({ crop: "soybeans", behind: [40], area: 10, ears: 2 }).lostBu, 1, 1e-12, "no ears in beans");
});

test("1/100 acre of row: 435.6 sq ft; 29.04 ft behind a 6-row 30 in head, 21.78 behind an 8-row", () => {
  near(L.rowFeet(6, 30), 29.04, 1e-9, "6x30");
  near(L.rowFeet(8, 30), 21.78, 1e-9, "8x30");
  // the baked table must be the same arithmetic
  for (const [rows, cells] of [[6, [20, 22, 30]], [8, [20, 22, 30]], [12, [20, 22, 30]], [16, [20, 22, 30]]]) {
    const want = cells.map((w) => L.rowFeet(rows, w).toFixed(1) + " ft");
    const re = new RegExp(`<tr><th scope="row">${rows} rows</th><td>${want[0]}</td><td>${want[1]}</td><td>${want[2]}</td></tr>`);
    assert.match(page, re, `${rows}-row table row`);
  }
  for (const [size, per, ten] of [["Small", 5, 50], ["Medium", 4, 40], ["Large", 3, 30]]) {
    const seeds = L.seedsFromPerSqFt(per, 60).toLocaleString("en-US");
    assert.match(page, new RegExp(`<tr><th scope="row">${size}</th><td>${per}</td><td>${ten}</td><td>${seeds}</td></tr>`), size);
  }
});

test("spots average; ahead of the combine comes off; dollars at the bid", () => {
  // spots 30, 50, 46 in 10 sq ft medium beans: avg 42 -> 1.05 bu/ac
  const o = L.loss({ crop: "soybeans", behind: [30, 50, 46], area: 10, bid: 10, acres: 500, yieldBu: 60 });
  near(o.behindAvg, 42, 1e-12, "average");
  near(o.lostBu, 1.05, 1e-12, "bu/ac");
  near(o.perAcre, 10.5, 1e-9, "$ an acre");
  near(o.farm, 5250, 1e-6, "500 acres");
  near(o.pctYield, 100 * 1.05 / 61.05, 1e-9, "share of the crop");
  // FAQ: 2 bu at $10 = $20 an acre, $10,000 on 500 acres
  const f = L.loss({ crop: "soybeans", behind: [80], area: 10, bid: 10, acres: 500 });
  near(f.perAcre, 20, 1e-9, "faq $20");
  near(f.farm, 10000, 1e-6, "faq $10,000");
  // 12 beans already down ahead: 1.05 - 0.3 = 0.75 bu/ac to the combine
  const m = L.loss({ crop: "soybeans", behind: [30, 50, 46], ahead: [12], area: 10 });
  near(m.aheadBu, 0.3, 1e-12, "ahead");
  near(m.machineBu, 0.75, 1e-12, "machine");
  near(m.lostBu, 0.75, 1e-12, "answer is the machine loss");
  near(m.totalBu, 1.05, 1e-12, "total kept");
  assert.equal(L.loss({ crop: "soybeans", behind: [5], ahead: [50], area: 10 }).machineBu, 0, "never below zero");
});

test("bad input returns nothing, not a number", () => {
  assert.equal(L.loss({ crop: "soybeans", behind: [], area: 10 }), null);
  assert.equal(L.grainsBu(5, 0, 4), null);
  assert.equal(L.grainsBu(-1, 10, 4), null);
  assert.equal(L.rowFeet(0, 30), null);
  assert.equal(L.avg([]), null);
});

/* ---------------- the page ---------------- */

test("page: head, canonical, byline, JSON-LD FAQ matches the visible FAQ, sources cited", () => {
  assert.match(page, /<title>Combine loss calculator: beans and kernels behind the combine \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/combine-loss">/);
  // Sig, Oct 18: no name at the top of a page; it sits in one line at the end
  assert.match(page, /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/);
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = blocks[0]["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  const seen = [...page.matchAll(/<details><summary>([^<]+)<\/summary><p>([^<]+)<\/p><\/details>/g)]
    .map((m) => [m[1], m[2]].map((s) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")));
  assert.ok(faq.length >= 5);
  assert.deepEqual(faq.map((q) => [q.name, q.acceptedAnswer.text]), seen);
  for (const u of ["cropwatch.unl.edu/2023/how-estimate-harvest-losses-soybeans-and-corn-fields", "crops.extension.iastate.edu/cropnews/2010/09/", "waupaca.extension.wisc.edu", "ndsu.edu/agriculture/extension"])
    assert.ok(page.includes(u), u);
  assert.match(page, /<script src="\/components\/bids-network\.js\?v=\d+" defer><\/script>/);
  assert.match(page, /<script src="\/components\/grain-shrink\.js\?v=\d+" defer><\/script>/, "reuses the shrink page's bid pickers");
  assert.match(ui, /NET\.snapshotForZip\(/);
  assert.match(ui, /SH\.nearestBid\(/);
  assert.match(ui, /SH\.defaultBid\(/);
});

test("copy: no em or en dashes, nothing AI-sounding, no store names", () => {
  for (const [name, s] of [["page", page], ["ui", ui], ["math", math]]) {
    assert.doesNotMatch(s, /[–—]|&mdash;|&ndash;/, name + " has a long dash");
    assert.doesNotMatch(s, /\b(delve|leverage|seamless|unlock|empower|game-changer)\b/i, name);
    assert.doesNotMatch(s, /\b(Amazon|Walmart|Tractor Supply|Fleet Farm|Etsy)\b/, name);
  }
});

test("honest empty state: no baked bid, no loss until something is counted", () => {
  assert.doesNotMatch(page, /<input id="cl-bid"[^>]*value=/, "no baked bid");
  assert.match(page, /Type your bid, or let the page fill one in\./);
  assert.match(page, /Count a spot to see the loss\./);
  assert.match(ui, /State estimate, not a posted bid/);
});

/* ---------------- in the browser ---------------- */

const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2" };
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
const INDEX = { generated: "2026-10-16T01:47:13Z", places: [
  { place: "x", operator: "Test Coop", city: "Bloomer", state: "WI", lat: 45.1, lon: -91.49, currency: "USD", zip: "54724",
    now: { soybeans: { cash: 9.8, basis: -0.6, period: "2026-10", delivery: "Oct" }, corn: { cash: 4.14, basis: -0.64, period: "2026-10", delivery: "Oct" } } }
] };

test("browser: tap-count beans, save spots, ZIP bid, then corn ears", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const port = srv.address().port;
    const bctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await bctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", async (r) => {
      const u = r.request().url(), h = { "access-control-allow-origin": "*" };
      if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify({ 54728: [45.31, -91.65] }) });
      if (u.includes("/bids/data/merged-index.json")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(INDEX) });
      if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
      return r.abort();
    });
    await pg.goto(`http://127.0.0.1:${port}/combine-loss`);
    await pg.waitForSelector("#cl-verdict");
    for (let i = 0; i < 30; i++) await pg.click("#cl-plus");
    await pg.click("#cl-save");
    await pg.fill("#cl-n", "50");
    // spots 30 and 50 in 10 sq ft, medium: 40 / 10 / 4 = 1.0 bu/ac
    await pg.waitForFunction(() => /^1\.0 bu\/ac on the ground\.$/.test(document.getElementById("cl-verdict").textContent));
    await pg.fill("#cl-zip", "54728");
    await pg.click("#cl-zipgo");
    await pg.waitForFunction(() => document.getElementById("cl-bid").value === "9.80");
    assert.match(await pg.textContent("#cl-bidsrc"), /Nearest posted soybeans bid: Test Coop, Bloomer WI/);
    await pg.waitForFunction(() => /1\.0 bu\/ac on the ground: \$9\.80 an acre at \$9\.80\./.test(document.getElementById("cl-verdict").textContent));
    // corn: 20 kernels in 10 sq ft (1 bu) + 1 ear (1 bu) at $4.14
    await pg.click('[data-crop="corn"]');
    await pg.waitForFunction(() => document.getElementById("cl-bid").value === "4.14");
    assert.match(await pg.textContent("#cl-walk"), /Walk 21\.8 feet/);
    await pg.fill("#cl-n", "20");
    await pg.click("#cl-eplus");
    await pg.waitForFunction(() => /^2\.0 bu\/ac on the ground: \$8\.28 an acre at \$4\.14\.$/.test(document.getElementById("cl-verdict").textContent));
    // the soybean spots are kept apart from corn
    await pg.click('[data-crop="soybeans"]');
    assert.match(await pg.textContent("#cl-spots"), /Saved spots: 30/);
    assert.deepEqual(errors, []);
    await bctx.close();
  } finally { await browser.close(); srv.close(); }
});
