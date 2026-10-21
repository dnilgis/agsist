/* /fast-facts "Corn N rate at posted prices" box, checked against UW
 * Extension A2809 Table 6.1 (Mar 2026 web edition, references-branch copy
 * uw-a2809-2026, read Oct 16, 2026) and worked by hand.
 *
 *   N:corn ratio = $/lb N / $/bu corn; $/lb N = $/ton / (2,000 x %N).
 *   A2809 prints four columns (0.05, 0.10, 0.15, 0.20); the box takes the
 *   nearest and says so when the ratio is past either end.
 *
 *   Anhydrous $820: 820 / 1,640 = $0.50/lb N. Corn $5.00: 0.100 -> 0.10.
 *     Loamy high, after soybean: 120 (105-130). 120 x 0.50 = $60/ac.
 *   Same N, Iowa basis -$0.40: corn $4.60, 0.50 / 4.60 = 0.109 -> 0.10.
 *     After corn: 165 (155-180).
 *   Urea $590: 590 / 920 = $0.641. / 4.60 = 0.139 -> 0.15. After corn: 150.
 *   Sand, irrigated: one row for every previous crop: 185 at 0.15.
 *   Corn typed $3.00: 0.641 / 3 = 0.214, past 0.20: 175, and it says so.
 *   Posted Oct 6 anhydrous $832 against Dec '27 $5.07 (the page on Oct 16):
 *     832 / 1,640 = 0.507; / 5.07 = 0.100 -> 0.10 -> 120 after soybean.
 *
 * Needs Playwright and Chromium for the browser parts; skipped where missing.
 *   node --test test/fast-facts-nrate.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const A = require(join(ROOT, "components/a2809.js"));
const html = readFileSync(join(ROOT, "fast-facts.html"), "utf8");
const js = readFileSync(join(ROOT, "components/fast-facts.js"), "utf8");
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

/* A2809 Table 6.1 as printed (MRTN, low, high) for 0.05, 0.10, 0.15, 0.20. */
const TABLE_6_1 = {
  hi_corn: [[190, 170, 210], [165, 155, 180], [150, 140, 160], [135, 125, 150]],
  hi_soy: [[140, 125, 160], [120, 105, 130], [105, 95, 115], [90, 80, 105]],
  med_corn: [[145, 130, 160], [125, 115, 140], [115, 105, 125], [105, 95, 110]],
  med_soy: [[130, 110, 150], [100, 85, 120], [85, 70, 95], [70, 60, 80]],
  sand_irr: [[215, 200, 230], [200, 185, 210], [185, 175, 195], [175, 165, 185]],
  sand_dry: [[140, 130, 150], [130, 120, 140], [120, 110, 130], [110, 100, 120]],
};

test("a2809.js Table 6.1 is A2809's, cell for cell", () => {
  assert.deepEqual(Object.keys(A.N_CORN).sort(), Object.keys(TABLE_6_1).sort());
  for (const [k, cells] of Object.entries(TABLE_6_1)) assert.deepEqual(A.N_CORN[k].cells, cells, k);
  assert.deepEqual(A.N_RATIOS, [0.05, 0.10, 0.15, 0.20]);
});

test("the printed N table is the same 72 numbers as a2809.js", () => {
  for (const [k, cells] of Object.entries(A.N_CORN)) {
    const row = html.match(new RegExp(`<tr data-row="${k}">(.*?)</tr>`));
    assert.ok(row, "row " + k);
    const got = [...row[1].matchAll(/<strong>(\d+)<\/strong><span class="rg">(\d+)&ndash;(\d+)<\/span>/g)].map((m) => [+m[1], +m[2], +m[3]]);
    assert.deepEqual(got, cells.cells, k);
  }
});

test("rates worked by hand", () => {
  const r = (row, ratio) => { const x = A.nRate({ row, ratio }); return [x.rate, x.lo, x.hi, x.col, x.off]; };
  assert.deepEqual(r("hi_soy", 820 / 1640 / 5.0), [120, 105, 130, 0.10, false]);
  assert.deepEqual(r("hi_corn", 820 / 1640 / 4.6), [165, 155, 180, 0.10, false]);
  assert.deepEqual(r("hi_corn", 590 / 920 / 4.6), [150, 140, 160, 0.15, false]);
  assert.deepEqual(r("sand_irr", 590 / 920 / 4.6), [185, 175, 195, 0.15, false]);
  assert.deepEqual(r("sand_irr", 590 / 920 / 3.0), [175, 165, 185, 0.20, true]);
  assert.deepEqual(r("med_soy", 0.04), [130, 110, 150, 0.05, true]);
  // The page on Oct 16: anhydrous $832, Dec '27 corn $5.07.
  assert.deepEqual(r("hi_soy", 832 / 1640 / 5.07), [120, 105, 130, 0.10, false]);
  assert.equal(A.nRate({ row: "hi_soy", ratio: 0 }), null);
  assert.equal(A.nRate({ row: "nope", ratio: 0.1 }), null);
});

test("legume credits follow A2809: no soybean credit for corn, red clover at 80%, sands get none", () => {
  assert.ok(html.includes("<strong>No soybean credit for corn or wheat:</strong>"));
  assert.ok(!/Soybean \(field crop\)<\/span><span class="ff-rv gold">20 lb N\/ac/.test(html), "soybean listed as a credit to subtract for corn");
  assert.ok(html.includes("80% of the alfalfa credit for a like stand"));
  assert.ok(html.includes("50 lb N/ac on medium and fine soils, none on sands"));
  // A2809 p.40: under 2% organic matter, high end on ALL soils (not only sands).
  assert.ok(html.includes("high end on any soil under 2% organic matter"));
  assert.ok(!html.includes("Sandy soils &lt;2% OM use high end"));
});

test("micronutrient categories are A2809 Table 8.4, and no unsourced tissue table is printed", () => {
  assert.ok(html.includes('<td class="tl">Zinc, all soils</td><td class="re">0&ndash;1.5</td><td>1.6&ndash;3.0</td><td class="gr">3.1&ndash;20</td>'));
  assert.ok(html.includes('<td class="tl">Boron, loamy</td><td class="re">0&ndash;0.3</td><td>0.4&ndash;0.8</td><td class="gr">0.9&ndash;1.5</td>'));
  assert.ok(html.includes('<td class="tl">Manganese, sandy or loamy</td><td class="re">n/a</td><td>0&ndash;10</td><td class="gr">11&ndash;20</td>'));
  assert.ok(!/&lt;0\.5 ppm DTPA|Ear Leaf at R1|Uppermost Trifoliate/.test(html), "old unsourced micronutrient or tissue numbers");
});

test("propane and shrink lines are the sourced figures", () => {
  assert.ok(html.includes("0.018 gal / bu / point (0.010&ndash;0.025)"));
  assert.ok(html.includes("9.5 &times; 0.018 = 0.17 gal/bu"));        // 9.5 x 0.018 = 0.171
  assert.ok(html.includes("1.18% a point (100 &divide; 84.5)"));        // 1 / 84.5 = 1.183%
  assert.ok(!/~0\.19 gal propane|Seeds per pound|Frost kills corn/.test(html));
});

test("no em dashes, no 'today's prices', byline and sources on the page", () => {
  const body = html.replace(/<!--[\s\S]*?-->/g, " ");
  assert.ok(!body.includes("—") && !body.includes("&mdash;"), "em dash in fast-facts.html");
  assert.ok(!js.includes("—"), "em dash in fast-facts.js");
  assert.ok(!/today(?:'|&rsquo;|’)s prices/i.test(body));
  // Sig, Oct 18: no name at the top of a page; it sits in one line at the end
  assert.ok(html.includes("Written and checked by Sigurd Lindquist, CCA, Chetek, Wisconsin."));
  assert.ok(!html.includes("By <strong>Sigurd Lindquist, CCA</strong>"));
  assert.ok(html.includes('id="ff-sources"'));
  assert.ok(html.includes("https://www.cornnratecalc.org/"));
});

/* ── in the browser ─────────────────────────────────────────────────── */
const FERT = {
  updated: "2026-10-06",
  prices: [
    { key: "anhydrous", name: "Anhydrous ammonia", symbol: "82-0-0", price: 820, as_of: "2026-10-06", src: "coop", region: "Kansas",
      src_label: "Test co-ops, middle of 3, posted Oct 6, 2026", short_label: "Test co-ops, Oct 6" },
    { key: "urea", name: "Urea", symbol: "46-0-0", price: 590, as_of: "2026-10-06", src: "coop", region: "Kansas",
      src_label: "Test co-ops, middle of 4, posted Oct 6, 2026", short_label: "Test co-ops, Oct 6" },
  ],
};
function newCropKey(now) {
  const y = now.getFullYear(), m = now.getMonth();
  return "corn-dec" + String((m >= 7 ? y + 1 : y) % 100).padStart(2, "0");
}
const PRICES = { quotes: {
  corn: { close: 450, close_date: "2026-10-16" },
  [newCropKey(new Date())]: { close: 500, close_date: "2026-10-16" },
} };
const BASIS = { min_n: 3, states: {
  IA: { name: "Iowa", crops: { corn: { label: "Dec '26", n: 50, median: -0.4 } } },
  AL: { name: "Alabama", crops: { corn: { label: "Dec '26", n: 1 } } },
} };

function serve() {
  const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/fast-facts") p = "/fast-facts.html";
    const f = normalize(join(ROOT, p));
    if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}
async function open(browser, port, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.storage) await ctx.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, opts.storage);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url();
    const j = (o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
    // the co-op sheets (components/fert-pick.js reads them first) are left out: these tests hand the page a price list
    if (u.includes("/data/fertilizer-coops.json")) return r.fulfill({ status: 404, body: "" });
    if (u.includes("/data/fertilizer-prices.json")) return opts.noFert ? r.fulfill({ status: 404, body: "" }) : j(FERT);
    if (u.includes("/data/prices.json")) return j(PRICES);
    if (u.includes("/data/basis-states.json")) return j(BASIS);
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  // the N box is on the Reference tables tab (Oct 21: My place opens first)
  await pg.goto(`http://127.0.0.1:${port}/fast-facts#tables`);
  return { pg, errors, ctx };
}
const txt = (pg, id) => pg.textContent(id);

test("the top box gives the A2809 rate at the posted price and next year's corn", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // The reader's saved location is in Iowa (geo.js keeps it under agsist-wx-loc).
    const { pg, errors } = await open(browser, port, { storage: { "agsist-wx-loc": JSON.stringify({ state: "IA", zip: "50010" }) } });
    await pg.waitForFunction(() => document.getElementById("ans-rate").textContent !== "-" && document.querySelector("#ans-state option[value=IA]"));
    // State basis by default: Dec futures $5.00 less Iowa's -$0.40 = $4.60.
    // Anhydrous first when a co-op posts it: 820 / 1640 = $0.50; 0.50 / 4.60 = 0.1087 -> 0.10.
    assert.equal(await pg.inputValue("#ans-state"), "IA");
    assert.equal(await pg.inputValue("#nc-fert"), "82");
    assert.equal(await pg.inputValue("#nc-fertprice"), "820");
    assert.equal(await pg.inputValue("#nc-corn"), "4.60");
    assert.equal(await txt(pg, "#nc-nlb"), "$0.50");
    assert.equal(await txt(pg, "#nc-ratio"), "0.109");
    assert.match(await txt(pg, "#ans-line"), /Against \$4\.60 corn \(Dec '\d\d futures \$5\.00 less Iowa basis \$0\.40\)/);
    assert.match(await txt(pg, "#ans-src"), /less \$0\.40, the median Iowa corn basis this week \(50 elevators, against Dec '26\)/);
    assert.equal(await txt(pg, "#nc-col"), "0.10");
    assert.equal(await txt(pg, "#ans-rate"), "120");
    assert.equal(await txt(pg, "#ans-range"), "Profitable range 105–130");
    assert.equal(await txt(pg, "#ans-cost"), "N cost $60/ac at $0.50/lb");
    assert.match(await txt(pg, "#ans-src"), /Anhydrous: Test co-ops, middle of 3, posted Oct 6, 2026/);
    assert.match(await txt(pg, "#ans-src"), /corn futures \$5\.00, CBOT close Oct 16, delayed/);
    // Futures only: $5.00, 0.50 / 5.00 = 0.100, still the 0.10 column.
    await pg.selectOption("#ans-state", "fut");
    assert.equal(await pg.inputValue("#nc-corn"), "5.00");
    assert.equal(await txt(pg, "#nc-ratio"), "0.100");
    assert.equal(await txt(pg, "#ans-rate"), "120");
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-ff-state")), "fut");
    // The same cell is marked in the full table.
    assert.equal(await pg.$eval('#nc-table tr[data-row="hi_soy"] td.act strong', (e) => e.textContent), "120");
    // The cost builder takes the same rate and price, and the corn soil test's
    // P and K (200 bu, P 22, K 110: A2809 40 and 60); no made-up seed or rent.
    assert.equal(await pg.inputValue("#eco-n-rate"), "120");
    assert.equal(await pg.inputValue("#eco-n-pplb"), "0.50");
    assert.equal(await pg.inputValue("#eco-p-rate"), "40");
    assert.equal(await pg.inputValue("#eco-k-rate"), "60");
    for (const id of ["#eco-seed", "#eco-chem", "#eco-rent", "#eco-other"]) assert.equal(await pg.inputValue(id), "", id);
    assert.match(await txt(pg, "#eco-total"), /^\$[\d.]+\/ac so far$/);
    // States with fewer elevators than the file's minimum are not offered.
    assert.equal(await pg.$("#ans-state option[value=AL]"), null);
    // Back to Iowa basis: 0.50 / 4.60 = 0.109 -> 0.10. After corn: 165.
    await pg.selectOption("#ans-state", "IA");
    await pg.selectOption("#ans-prev", "corn");
    assert.equal(await pg.inputValue("#nc-corn"), "4.60");
    assert.equal(await txt(pg, "#nc-ratio"), "0.109");
    assert.equal(await txt(pg, "#ans-rate"), "165");
    assert.match(await txt(pg, "#ans-src"), /less \$0\.40, the median Iowa corn basis this week \(50 elevators, against Dec '26\)/);
    // Urea at its posted $590: 0.641 / 4.60 = 0.139 -> 0.15 -> 150.
    await pg.selectOption("#nc-fert", "46");
    assert.equal(await pg.inputValue("#nc-fertprice"), "590");
    assert.equal(await txt(pg, "#nc-ratio"), "0.139");
    assert.equal(await txt(pg, "#ans-rate"), "150");
    // Sands: one row for every previous crop, and the crop box says so by going grey.
    await pg.selectOption("#ans-soil", "sand_irr");
    assert.equal(await txt(pg, "#ans-rate"), "185");
    assert.equal(await pg.$eval("#ans-prev", (e) => e.disabled), true);
    // A typed corn price wins, and a ratio past the table says it is the end column.
    await pg.fill("#nc-corn", "3");
    assert.equal(await txt(pg, "#nc-ratio"), "0.214");
    assert.equal(await txt(pg, "#ans-rate"), "175");
    assert.match(await txt(pg, "#ans-line"), /past the table’s 0\.20 end/);
    assert.match(await txt(pg, "#ans-src"), /corn price: yours/);
    // UAN 28% has no posted price here: no number until the reader types one.
    await pg.selectOption("#nc-fert", "28");
    assert.equal(await pg.inputValue("#nc-fertprice"), "");
    assert.equal(await txt(pg, "#ans-rate"), "-");
    assert.match(await txt(pg, "#ans-line"), /Type your N price per ton/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no fertilizer file: the box shows no rate and asks for a price", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { noFert: true, storage: { "agsist-ff-state": "fut" } });
    await pg.waitForFunction(() => document.getElementById("nc-corn").value !== "");
    await pg.waitForTimeout(300);
    assert.equal(await txt(pg, "#ans-rate"), "-");
    assert.equal(await pg.inputValue("#nc-fertprice"), "");
    assert.match(await txt(pg, "#ans-line"), /Type your N price per ton/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("phone 390 px: the rate is on the first screen, nothing scrolls sideways, the N table fits", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port, { viewport: { width: 390, height: 844 }, storage: { "agsist-ff-state": "IA" } });
    await pg.waitForFunction(() => document.getElementById("ans-rate").textContent !== "-");
    const box = await pg.$eval("#ans-rate", (e) => e.getBoundingClientRect().bottom);
    assert.ok(box < 844, "rate below the first screen: " + box);
    assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), 390);
    const w = await pg.$eval("#nc-table", (e) => e.getBoundingClientRect().width);
    assert.ok(w <= 390 - 16, "N table wider than the phone: " + w);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("no state known: the box asks for one instead of guessing, then uses its basis", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, port);
    await pg.waitForFunction(() => document.querySelector("#ans-state option[value=IA]") && document.getElementById("nc-fertprice").value !== "");
    await pg.waitForTimeout(300);
    assert.equal(await pg.inputValue("#ans-state"), "");
    assert.equal(await pg.inputValue("#nc-corn"), "");
    assert.equal(await txt(pg, "#ans-rate"), "-");
    assert.match(await txt(pg, "#ans-line"), /^Pick your state: the corn price is December futures less your state’s elevator basis this week/);
    // Iowa: 5.00 - 0.40 = 4.60; 820 / 1640 / 4.60 = 0.109 -> 0.10 -> 120, after soybeans, high-yield loam.
    await pg.selectOption("#ans-state", "IA");
    assert.equal(await pg.inputValue("#nc-corn"), "4.60");
    assert.equal(await txt(pg, "#ans-rate"), "120");
    assert.equal(await pg.evaluate(() => localStorage.getItem("agsist-ff-state")), "IA");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
