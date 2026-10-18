/* Harvest now or wait (components/harvest-wait.js, harvest-wait-ui.js) and the
 * /harvest-or-wait page.
 *
 * The shipped files run here. Every worked example is from a source read in
 * full on the references branch (NDSU Hellevang 2009 = ndsu-late-corn-2009,
 * Iowa State ICM 2022 = bench-grain-shrink-5, Purdue GQ-3 = purdue-gq-3) or
 * is the arithmetic written out beside it, so a reader can redo it by hand.
 * Browser checks need Playwright and Chromium and skip without them.
 *
 *   node --test test/harvest-wait.test.mjs
 *   HW_SHOTS=/some/dir node --test test/harvest-wait.test.mjs   # also screenshots
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { bake, FAQ } from "../scripts/build_harvest_wait.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/harvest-wait.js", "utf8"), ctx);
const H = ctx.AgHarvestWait;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "harvest-or-wait.html", "utf8");
const ui = readFileSync(ROOT + "components/harvest-wait-ui.js", "utf8");
const math = readFileSync(ROOT + "components/harvest-wait.js", "utf8");
const bakeSrc = readFileSync(ROOT + "scripts/build_harvest_wait.mjs", "utf8");
const LP = (price) => ({ kind: "lp", price, gal: 0.018 });

/* ---------------- hand-worked examples ---------------- */

test("Purdue GQ-3: 28% to 15% with LP at 60 cents is 13.5 cents a bushel; 22% to 15% is 8.2", () => {
  // 20,624 x 0.60 / 92,000 = 0.13450; 12,589 x 0.60 / 92,000 = 0.08210
  near(H.gq3FuelPerBu(28, 15, 0.6), 0.1345, 0.0001, "28 to 15");
  near(H.gq3FuelPerBu(22, 15, 0.6), 0.0821, 0.0001, "22 to 15");
  assert.equal(H.LP_BTU_PER_GAL, 92000);
  // Table corners as printed
  assert.equal(H.gq3Btu(22, 17), 8744);
  assert.equal(H.gq3Btu(30, 13), 26744);
  // Between columns and rows: 25% to 15.5%. Row 16: 13,506 + (16,241 - 13,506)/2 = 14,873.5;
  // row 15: 15,447 + (18,118 - 15,447)/2 = 16,782.5; halfway = 15,828.
  near(H.gq3Btu(25, 15.5), 15828, 1e-9, "interpolated");
  // The table stops at 22 to 30 in and 13 to 17 out: nothing outside it
  assert.equal(H.gq3Btu(20, 15), null);
  assert.equal(H.gq3Btu(31, 15), null);
  assert.equal(H.gq3Btu(25, 12), null);
});

test("GQ-3 per point lands near Iowa State's 0.018 gallons", () => {
  // 22: 12,589/92,000/7 = 0.01955 ... 30: 22,978/92,000/15 = 0.01665
  const fi = H.GQ3.final.indexOf(15);
  const per = H.GQ3.initial.map((mi, c) => H.GQ3.btu[fi][c] / 92000 / (mi - 15));
  near(per[0], 0.01955, 0.00001, "from 22");
  near(per[4], 0.01665, 0.00001, "from 30");
  for (const p of per) assert.ok(p >= H.LP_GAL_RANGE[0] && p <= H.LP_GAL_RANGE[1], "inside ISU's 0.010 to 0.025");
});

test("Iowa State ICM 2022: 0.018 gallons x 1,000 bushels x 5 points = 90 gallons", () => {
  // At $1.50 that is $135, 13.5 cents a wet bushel.
  near(H.dryPerWetBu(20, 15, LP(1.5)) * 1000, 135, 1e-9, "dollars on 1,000 bu");
  near(H.dryPerWetBu(20, 15, LP(1.5)) / 1.5 * 1000, 90, 1e-9, "gallons");
  assert.equal(H.LP_GAL_PER_BU_PT, 0.018);
  // cents a point: 4 cents x 5 points = 20 cents
  near(H.dryPerWetBu(20, 15, { kind: "point", cents: 4 }), 0.2, 1e-12, "cents a point");
  assert.equal(H.dryPerWetBu(14, 15.5, LP(1.5)), 0, "already dry costs nothing");
  assert.equal(H.dryPerWetBu(20, 15, { kind: "lp" }), null, "no price, no number");
});

test("NDSU 2009 table: the rates by month, and NDSU's own 35% corn example", () => {
  assert.deepEqual({ ...H.CAL.weekly }, { 9: 4.5, 10: 2.5, 11: 1.0, 12: 0.5 });
  assert.deepEqual({ ...H.CAL.emc }, { 9: 15, 10: 16, 11: 19, 12: 20 });
  // 35% on Oct 11. Oct 12 to 31 is 20 days x 2.5/7 = 7.143; Nov 1 is 1/7 = 0.143. 35 - 7.286 = 27.71.
  // NDSU: "about 27% by November 1".
  const s = H.calendarDrydown(35, "2026-10-11", 51);
  assert.equal(s[21].date, "2026-11-01");
  near(s[21].m, 27.714, 0.001, "Nov 1 by the weekly table");
  near(s[21].m, 27, 1, "NDSU's about 27");
  // Nov 2 to 30 is 29 days x 1/7 = 4.143, Dec 1 is 0.5/7 = 0.071: 27.714 - 4.214 = 23.50.
  // NDSU's prose says "about 22% by December 1"; their per-day November range
  // (0.15 to 0.2 a day) gives 21.7 to 23.2. The weekly table runs 1.5 points slower.
  assert.equal(s[51].date, "2026-12-01");
  near(s[51].m, 23.5, 0.001, "Dec 1 by the weekly table");
  near(s[51].m, 22, 1.5 + 1e-9, "NDSU's about 22");
});

test("drydown stops at the month's equilibrium moisture, and outside Sep to Dec it needs the reader's rate", () => {
  // 19.5% on Nov 1: Nov floor is 19, so 14 days of 1/7 a day stops at 19.
  assert.equal(H.calendarDrydown(19.5, "2026-11-01", 14)[14].m, 19);
  // Already under the floor: no drying at all
  assert.equal(H.calendarDrydown(17, "2026-11-01", 3)[3].m, 17);
  // August is not in the table
  assert.equal(H.calendarDrydown(25, "2026-08-01", 3), null);
  // With the reader's 1 point a week, 7 days in August: 24
  near(H.calendarDrydown(25, "2026-08-01", 7, 1)[7].m, 24, 1e-9, "own rate");
  // Own rate in October keeps October's 16% floor
  assert.equal(H.calendarDrydown(17, "2026-10-01", 14, 7)[14].m, 16);
  // Oct 16 to Oct 26, 10 days x 2.5/7: 25 - 3.571 = 21.43
  near(H.calendarDrydown(25, "2026-10-16", 10)[10].m, 21.4286, 0.0001, "10 days in October");
});

test("wait or go, by hand: 200 bu/ac, 25% now, 21.5% later, LP $1.50, $4 corn, 1 bu/ac a week for 14 days", () => {
  // Now: 200 x 84.5/75 = 225.33 wet bu; 0.018 x 9.5 x 1.50 = 25.65 cents; 225.33 x 0.2565 = $57.80
  // Later: 200 x 84.5/78.5 = 215.29 wet bu; 0.018 x 6 x 1.50 = 16.2 cents; $34.88
  // Saved $22.92. Break-even 22.92 / 4 = 5.73 bu. Loss 2 bu x $4 = $8. Net $14.92. 500 acres: $7,461.
  const c = H.compare(25, 21.5, 14, { yieldBu: 200, to: 15.5, cost: LP(1.5), bid: 4, lossPerWeek: 1, acres: 500 });
  near(c.now.wetBu, 225.333, 0.001, "wet bu now");
  near(c.now.perAcre, 57.798, 0.001, "drying now");
  near(c.then.wetBu, 215.287, 0.001, "wet bu later");
  near(c.then.perAcre, 34.876, 0.001, "drying later");
  near(c.saved, 22.922, 0.001, "saved");
  near(c.breakEvenBu, 5.730, 0.001, "break-even");
  near(c.lossBu, 2, 1e-12, "loss bu");
  near(c.lossDollars, 8, 1e-12, "loss $");
  near(c.net, 14.922, 0.001, "net");
  near(c.netFarm, 7460.78, 0.01, "500 acres");
});

test("field loss is never ours: no loss given, no net, only the break-even", () => {
  const c = H.compare(25, 21.5, 14, { yieldBu: 200, to: 15.5, cost: LP(1.5), bid: 4 });
  assert.equal(c.net, undefined);
  assert.equal(c.lossBu, undefined);
  assert.ok(c.breakEvenBu > 0);
  const noBid = H.compare(25, 21.5, 14, { yieldBu: 200, to: 15.5, cost: LP(1.5) });
  assert.equal(noBid.breakEvenBu, undefined, "no bid, no break-even");
  const noCost = H.compare(25, 21.5, 14, { yieldBu: 200, to: 15.5, cost: null, bid: 4 });
  assert.equal(noCost.saved, undefined, "no fuel price, no dollars");
  assert.match(page, /<input id="hw-loss"[^>]*placeholder="your guess"/);
  assert.doesNotMatch(page, /<input id="hw-loss"[^>]*value=/, "no baked field loss");
  assert.doesNotMatch(page, /<input id="hw-lp"[^>]*value=/, "no baked LP price");
  assert.doesNotMatch(page, /<input id="hw-bid"[^>]*value=/, "no baked bid");
});

test("GDD: 86/50 day, and the GDD drydown rule stays off until its source is read", () => {
  assert.equal(H.gddDay(80, 40), 15);  // (80 + 50)/2 - 50
  assert.equal(H.gddDay(90, 60), 23);  // (86 + 60)/2 - 50
  assert.equal(H.gddDay(45, 30), 0);
  assert.equal(H.gddDay(null, 30), null);
  assert.equal(H.GDD_RULE.checked, false,
    "Turn the GDD rule on only after reading its band numbers in refs/purdue-grain-drydown.txt (or the ISU original); then replace this line with a test of those numbers.");
  assert.equal(H.gddDrydown(28, [10, 10]), null, "off: no moisture from heat");
  // The banding arithmetic itself, on a rule switched on for this test only:
  // 28% with 30 GDD a point: 10 GDD = 0.333 point. 30 GDD past 25% at 45 a point.
  const r = { checked: true, bands: H.GDD_RULE.bands };
  const g = H.gddDrydown(28, [10, 10, 10, 30, 60, 90], r);
  near(g[3], 27, 1e-9, "30 GDD = 1 point");
  near(g[5], 24.333, 0.001, "60 GDD: 1 point to 25, then 30/45");
  assert.match(page, /does not turn it into moisture until we have read those rules/);
});

/* ---------------- the page ---------------- */

test("page: head, canonical, byline, JSON-LD, baked tables match the math", () => {
  assert.match(page, /<title>Harvest corn now or wait\? Drying cost vs field loss calculator \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/harvest-or-wait">/);
  // Sig, Oct 18: no name at the top of a page; it sits in one line at the end
  assert.match(page, /<p class="by-end"[^>]*>Made by <a href="\/about">Sigurd Lindquist, CCA<\/a>, Chetek, Wisconsin\.<\/p>/);
  assert.equal((page.match(/<h1>/g) || []).length, 1);
  for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  assert.equal(bake(page), page, "run node scripts/build_harvest_wait.mjs");
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  assert.equal(faq.length, FAQ.length);
  assert.ok(faq.length >= 5);
  assert.match(page, /<tr><th scope="row">October<\/th><td>2\.5<\/td><td>0\.36<\/td><td>16<\/td><\/tr>/);
  assert.match(page, /<tr><th scope="row">28%<\/th><td>20,624<\/td><td>0\.224<\/td><td>0\.0172<\/td><\/tr>/);
  assert.match(page, /gq\/gq-3\.html/);
  assert.match(page, /cropnews\/2022\/10\/options-fall-grain-drying-and-marketing/);
  assert.match(page, /Post%20Harvest%20Tips%20for%20Later%20Maturing%20Corn/);
  assert.match(page, /class="hw-est">Estimate</);
  for (const s of ["/components/bids-network.js", "/components/grain-shrink.js", "/components/harvest-wait.js", "/components/harvest-wait-ui.js"])
    assert.ok(page.indexOf(s) > 0, s);
  assert.ok(page.indexOf("/components/harvest-wait.js") < page.indexOf("/components/harvest-wait-ui.js"), "math loads before the page script");
  assert.ok(Buffer.byteLength(page) < 150 * 1024, "under the 150 KB page cap");
});

test("copy: no em or en dashes, nothing AI-sounding, no store names", () => {
  for (const [name, s] of [["page", page], ["ui", ui], ["math", math], ["bake", bakeSrc]]) {
    assert.doesNotMatch(s, /[–—]|&mdash;|&ndash;/, name + " has a long dash");
    assert.doesNotMatch(s, /\b(delve|leverage|seamless|unlock|empower|game-changer|robust)\b/i, name);
    assert.doesNotMatch(s, /\b(Amazon|Walmart|Tractor Supply|Fleet Farm|Etsy)\b/, name);
  }
});

test("bid comes from the shared readers, labeled", () => {
  assert.match(ui, /NET\.snapshotForZip\(/);
  assert.match(ui, /S\.nearestBid\(st\.snap, 'corn'\)/);
  assert.match(ui, /State estimate, not a posted bid/);
  assert.match(page, /Type your bid, or let the page fill one in\./);
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
    now: { corn: { cash: 4.14, basis: -0.64, period: "2026-10", delivery: "Oct" } } }
] };
/* 15 days from Oct 16, every day 60/40: (60 + 50)/2 - 50 = 5 GDD. */
const FORECAST = { daily: { time: Array.from({ length: 15 }, (_, i) => `2026-10-${String(16 + i).padStart(2, "0")}`),
  temperature_2m_max: Array(15).fill(60), temperature_2m_min: Array(15).fill(40) } };
async function open(browser, port, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: opts.scheme || "dark" });
  const pg = await ctx.newPage();
  const errors = [], hits = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.clock.setFixedTime(new Date("2026-10-16T10:00:00"));
  await pg.route("**/*", async (r) => {
    const u = r.request().url(), h = { "access-control-allow-origin": "*" };
    if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify({ 54728: [45.31, -91.65] }) });
    if (u.includes("/bids/data/merged-index.json")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(INDEX) });
    if (u.startsWith("https://api.open-meteo.com/v1/forecast")) { hits.push(u); return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(FORECAST) }); }
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/harvest-or-wait`);
  return { pg, ctx, errors, hits };
}
const verdict = (pg, re) => pg.waitForFunction((s) => new RegExp(s).test(document.getElementById("hw-verdict").textContent), re.source);

test("browser: moisture first, then dollars, break-even, and a yes or no only with the reader's loss", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  const shots = process.env.HW_SHOTS;
  try {
    const { pg, errors, hits } = await open(browser, srv.address().port);
    // 25% on Oct 16, 10 days at 2.5/7: 21.4% by Oct 26. No fuel price: no dollars.
    await verdict(pg, /Corn at 25\.0% today to about 21\.4% by Oct 26\. Add your drying cost/);
    assert.equal(await pg.locator("#hw-rows tr").count(), 15, "today plus 14 days");
    await pg.fill("#hw-lp", "1.50");
    // Now $57.80; Oct 26: 200 x 84.5/78.571 = 215.09 wet bu x (0.018 x 5.929 x 1.50) = $34.43. Saved $23.37.
    await verdict(pg, /Waiting 10 days saves about \$23\.37 an acre in drying\./);
    await pg.fill("#hw-zip", "54728");
    await pg.click("#hw-zipgo");
    await pg.waitForFunction(() => document.getElementById("hw-bid").value === "4.14");
    assert.match(await pg.textContent("#hw-bidsrc"), /Nearest posted corn bid: Test Coop, Bloomer WI/);
    // 23.37 / 4.14 = 5.64 bu
    await verdict(pg, /It pays only if the field loses less than 5\.6 bushels an acre by Oct 26\./);
    assert.equal((await pg.getAttribute("#hw-answer", "class")).trim(), "hw-answer v-even");
    // Forecast: 10 days x 5 GDD = 50, shown, not used for moisture
    await pg.waitForFunction(() => /50 GDD/.test(document.getElementById("hw-kv").textContent));
    assert.equal(hits.length, 1);
    assert.match(hits[0], /forecast_days=15/);
    assert.match(await pg.textContent("#hw-drysrc"), /not by your weather.*shown for reference/);
    if (shots) await pg.screenshot({ path: shots + "/hw-mobile-breakeven.png", fullPage: true });
    // 1 bu a week: 1.43 bu x 4.14 = $5.91. 23.37 - 5.91 = $17.45 ahead.
    await pg.fill("#hw-loss", "1");
    await verdict(pg, /Waiting 10 days comes out about \$17\.45 an acre ahead\./);
    // 5 bu a week: 7.14 x 4.14 = $29.57. 23.37 - 29.57 = -$6.20.
    await pg.fill("#hw-loss", "5");
    await verdict(pg, /Harvest now: waiting 10 days costs about \$6\.20 an acre\./);
    // 14 days: 25 - 5 = 20%
    await pg.click('[data-days="14"]');
    await pg.waitForFunction(() => /25\.0% → 20\.0%/.test(document.getElementById("hw-kv").textContent));
    await pg.click("#hw-mathbox summary");
    assert.match(await pg.textContent("#hw-math"), /Break-even loss = /);
    assert.match(await pg.textContent("#hw-math"), /Purdue GQ-3 column dryer, 25\.0% to 15\.5%: 15,828 BTU/);
    if (shots) await pg.screenshot({ path: shots + "/hw-mobile-harvestnow.png", fullPage: true });
    // The reader's own rate replaces the month's
    await pg.fill("#hw-own", "3.5");
    await pg.waitForFunction(() => /25\.0% → 18\.0%/.test(document.getElementById("hw-kv").textContent));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: desktop, light", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, srv.address().port, { viewport: { width: 1200, height: 900 }, scheme: "light" });
    await pg.fill("#hw-m", "28");
    await pg.check('input[name="hw-cost"][value="point"]');
    await pg.fill("#hw-cpp", "4");
    await pg.fill("#hw-bid", "4.00");
    // 28% for 10 days: 24.43%. Now 200 x 84.5/72 = 234.72 x 12.5 x 4c = $117.36.
    // Later 200 x 84.5/75.571 = 223.63 x 8.929 x 4c = $79.87. Saved $37.49. Break-even 9.4 bu.
    await verdict(pg, /saves about \$37\.4\d an acre in drying\. It pays only if the field loses less than 9\.4 bushels/);
    const w = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 1200, "no sideways scroll");
    if (process.env.HW_SHOTS) await pg.screenshot({ path: process.env.HW_SHOTS + "/hw-desktop-light.png", fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
