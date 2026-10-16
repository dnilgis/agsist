/* /fast-facts against UW Extension A2809 itself (Mar 2026 web edition, the
 * references-branch copy uw-a2809-2026 read Oct 16, 2026), and the crop stage
 * table shared with /gdu-calculator.
 *
 * Hand-worked cases, each from the printed tables:
 *   Corn grain 200 bu, loamy, P 22, K 110 (demand 1): Table 7.1 P 21-30 is
 *     High, Table 7.2 K 101-130 is Optimum; Table 7.4 row 191-210 bu gives
 *     H 40 lb P2O5 and O 60 lb K2O. (The page used to say Optimum, 75.)
 *   Corn 200 bu, P 35, K 195: P >30 and K >190 are Excessively High: 0 and 0.
 *   Corn 200 bu, K 65: K <70 is Very Low: 105 lb K2O.
 *   Corn silage 25 t, P 20, K 120 (demand 2, loamy): P 18-25 O, K 111-140 O;
 *     row 20.1-25 t: 80 lb P2O5, 185 lb K2O.
 *   Alfalfa established 5 t, P 20, K 120: both Optimum; row 4.6-5.5 t:
 *     65 lb P2O5, 300 lb K2O. (The page used to say 55 and 40.)
 *   Soybean 60 bu, P 20, K 120: O and O; row 56-65 bu: 50 and 85.
 *   Corn 200 bu on sandy soil, P 22, K 110: Table 7.1 sandy P 12-22 Low,
 *     Table 7.2 sandy K 91-130 High; row 191-210: L 105 P2O5, H 30 K2O.
 *   Corn 200 bu, loamy, rotation with alfalfa (demand 2), P 22, K 110:
 *     P 18-25 O -> 75; K 90-110 L -> 90.
 * Lime, Table 5.1 (60-69 NI lime, tons/a), x 65/NI, rounded to 1 t for
 * 60-69 and 0.5 t above:
 *   Buffer 6.5, water 6.0, target 6.8: 195 - 28.4 x 6.5 + 0.144 x 6.0 =
 *     11.264 -> 11 t of 60-69; x 65/85 = 8.61 -> 8.5 t of 80-89.
 *   Same soil, target 6.3: 103 - 12.6 x 6.5 - 3.18 x 6.0 = 2.02 -> 2 t;
 *     x 65/85 = 1.545 -> 1.5 t.
 *   Water 5.7, buffer 6.5, target 6.0: 72.7 - 7.59 x 6.5 - 3.78 x 5.7 =
 *     1.819, under the 2 t minimum: 2 t of 60-69, 2 x 65/85 = 1.53 -> 1.5 t.
 *   Water 6.0, target 6.0: not more than 0.2 below target, no lime.
 *   Tillage over 9 in at target 6.8: 11.264 x 1.46 = 16.4 t, capped at 12.
 *
 *   node --test test/fast-facts-a2809.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
function load(p, name) { const w = {}; vm.runInNewContext(read(p), { window: w }); return w[name]; }
const A = load("components/a2809.js", "AgA2809");
const G = load("components/gdu-stages.js", "AgGduStages");
const html = read("fast-facts.html");
const js = read("components/fast-facts.js");

const pk = (crop, y, p, k, soil = "loamy", rotation = 1) => {
  const r = A.pk({ crop, yieldGoal: y, p, k, soil, rotation });
  return [r.pCat, r.kCat, r.p2o5, r.k2o];
};

test("P and K categories and rates match A2809 Tables 7.1, 7.2 and 7.4", () => {
  assert.deepEqual(pk("corn", 200, 22, 110), ["H", "O", 40, 60]);
  assert.deepEqual(pk("corn", 200, 35, 195), ["EH", "EH", 0, 0]);
  assert.deepEqual(pk("corn", 200, 22, 65).filter((_, i) => i % 2), ["VL", 105]);
  assert.deepEqual(pk("corn_silage", 25, 20, 120), ["O", "O", 80, 185]);
  assert.deepEqual(pk("alfalfa", 5, 20, 120), ["O", "O", 65, 300]);
  assert.deepEqual(pk("soybean", 60, 20, 120), ["O", "O", 50, 85]);
  assert.deepEqual(pk("corn", 200, 22, 110, "sandy"), ["L", "H", 105, 30]);
  assert.deepEqual(pk("corn", 200, 22, 110, "loamy", 2), ["O", "L", 75, 90]);
  assert.deepEqual(pk("alfalfa_seeding", 2, 20, 120), ["O", "O", 25, 105]);
  // Edges of the printed ranges: P "10-15" Low, "16-20" Optimum, "21-30" High, ">30".
  for (const [p, c] of [[9, "VL"], [10, "L"], [15, "L"], [16, "O"], [20, "O"], [21, "H"], [30, "H"], [31, "EH"]])
    assert.equal(A.pk({ crop: "corn", yieldGoal: 200, p, k: 120 }).pCat, c, "P " + p);
  // K "131-160" High, "161-190" Very High (quarter of optimum: 15 at 191-210 bu).
  assert.deepEqual(pk("corn", 200, 20, 170).filter((_, i) => i % 2), ["VH", 15]);
  // Sandy soils at demand level 1 have no K Very High class: 131 is EH.
  assert.equal(A.pk({ crop: "corn", yieldGoal: 200, p: 20, k: 131, soil: "sandy" }).kCat, "EH");
  // Yield rows: 25 t is in the 20.1-25 row, 25.5 in 25.1-30.
  assert.equal(A.pk({ crop: "corn_silage", yieldGoal: 25.5, p: 20, k: 120 }).k2o, 230);
  const top = A.pk({ crop: "corn", yieldGoal: 300, p: 20, k: 120 });
  assert.ok(top.aboveTable);
  assert.equal(top.p2o5, 100);
});

test("A2809 rules hold across every rate row: H is half of O, K VH a quarter, EH none", () => {
  for (const [crop, c] of Object.entries(A.CROPS)) {
    for (const r of c.rows) {
      const [pVL, pL, pO, pH, pEH, kVL, kL, kO, kH, kVH, kEH] = r.slice(2);
      assert.ok(pVL > pL && pL > pO && pO > pH, crop + " P order " + r);
      assert.ok(Math.abs(pH - pO / 2) <= 2.5, crop + " P H half of O " + r);
      assert.ok(Math.abs(kH - kO / 2) <= 2.5, crop + " K H half of O " + r);
      assert.ok(Math.abs(kVH - kO / 4) <= 2.5, crop + " K VH quarter of O " + r);
      assert.equal(pEH, 0); assert.equal(kEH, 0);
      assert.ok(kVL > kL && kL > kO);
    }
  }
});

test("lime follows A2809 Table 5.1, 65/NI, its rounding, minimum and cap", () => {
  const L = (o) => A.lime(Object.assign({ wph: 6.0, bph: 6.5, target: 6.8, ni: 85, depth: 7 }, o));
  let r = L({});
  assert.equal(r.base60, 11);
  assert.ok(Math.abs(r.base - 11.264) < 1e-9);
  assert.equal(r.tons, 8.5);
  assert.equal(L({ ni: 65 }).tons, 11);
  r = L({ target: 6.3 });
  assert.equal(r.base60, 2); assert.equal(r.tons, 1.5); assert.equal(r.rule, null);
  r = L({ wph: 5.7, target: 6.0 });
  assert.equal(r.rule, "min"); assert.equal(r.tons, 1.5);
  assert.equal(L({ wph: 5.7, target: 6.0, ni: 65 }).tons, 2);
  assert.equal(L({ target: 6.0 }).need, false);
  assert.equal(L({ wph: 6.6 }).need, false, "0.2 below target is not more than 0.2");
  assert.equal(L({ wph: 6.5 }).need, true);
  r = L({ depth: 10, ni: 65 });
  assert.equal(r.tons, 12); assert.ok(r.capped);
  // Sands under 1% OM: 1 t when the formula is under 1.5 t. Buffer 6.6,
  // water 6.0, target 6.3: 103 - 12.6 x 6.6 - 3.18 x 6.0 = 0.76 t -> 1 t.
  r = L({ bph: 6.6, target: 6.3, sandyLowOM: true });
  assert.equal(r.rule, "sandy"); assert.equal(r.tons, 1);
  // Over 1.5 t on those sands, no 2 t minimum: 1.819 x 65/85 = 1.39 -> 1.5 t.
  r = L({ wph: 5.7, target: 6.0, sandyLowOM: true });
  assert.equal(r.rule, null); assert.equal(r.tons, 1.5);
});

test("the page prints A2809's tables from the same rows the calculator uses", () => {
  // Category table: every row in fast-facts.html equals the module's bounds.
  for (const d of [1, 2]) for (const soil of ["loamy", "sandy"]) for (const [n, T] of [["P", A.P_CATS], ["K", A.K_CATS]]) {
    const row = html.match(new RegExp(`<tr data-a2809="${n}-${d}-${soil}">(.*?)</tr>`));
    assert.ok(row, `${n}-${d}-${soil} row missing`);
    const cells = [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1]).slice(2);
    const b = T[d][soil];
    assert.equal(cells[0], "&lt;" + b.L);
    assert.equal(cells[1], `${b.L}&ndash;${b.O - 1}`);
    assert.equal(cells[5], "&gt;" + (b.EH - 1));
  }
  // Rate tables: every printed rate row is in the module, for all four crops.
  const want = [["Corn Grain", "corn"], ["Soybean", "soybean"], ["Corn Silage", "corn_silage"], ["Alfalfa", "alfalfa"]];
  for (const [h, crop] of want) {
    const start = html.indexOf(`<div class="ff-h2">${h} P&#x2082;O&#x2085; &amp; K&#x2082;O Rates`);
    assert.ok(start > 0, h);
    const body = html.slice(start, html.indexOf("</table>", start));
    const rows = [...body.matchAll(/<tr><td class="tl">([\d.]+)&ndash;([\d.]+)<\/td>(.*?)<\/tr>/g)];
    const rr = A.CROPS[crop].rows;
    assert.equal(rows.length, rr.length * 2, h + " row count");
    rows.forEach((m, i) => {
      const r = rr[i % rr.length];
      const nums = [...m[3].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((x) => x[1]);
      const expect = i < rr.length ? [r[2], r[3], r[4], r[5], "n/a", r[6]] : r.slice(7, 13);
      assert.deepEqual(nums.map(String), [...expect].map(String), `${h} row ${i}`); // [...] : the module lives in another vm realm
      assert.equal(+m[1], r[0]); assert.equal(+m[2], r[1]);
    });
  }
  // No old one-size breakpoints, no unsourced Olsen factor, lime credited right.
  assert.ok(!html.includes("<td class=\"re\">&lt;11</td><td class=\"re\">&lt;61</td>"));
  assert.ok(!/Olsen P &times; 1\.6/.test(html));
  assert.ok(!/SMP-buffer calibration/.test(html));
  assert.ok(!/SMP_FACTORS|ST_P=|ST_K=/.test(js), "a second copy of the tables in fast-facts.js");
  assert.ok(html.includes("https://cropsandsoils.extension.wisc.edu/files/2026/03/A2809-web.pdf"));
});

test("one GDU stage table: fast-facts and gdu-calculator both read components/gdu-stages.js", () => {
  const gdu = read("gdu-calculator.html");
  for (const page of [html, gdu]) assert.match(page, /<script src="\/components\/gdu-stages\.js\?v=\d+"/);
  assert.ok(!/\[\['VE',0\]/.test(js), "fast-facts.js carries its own stage list again");
  assert.ok(!/\{s:'R3',gdu:1750/.test(js + gdu));
  assert.ok(!/gdu:\s*\d+/.test(js), "fast-facts.js hard-codes a stage GDU");
  assert.ok(!/var CORN_STAGES=\[\s*\{/.test(gdu), "gdu-calculator.html carries its own stage list again");
  // The GDU page's reference tables print the same numbers for every stage they list.
  const byName = (list) => Object.fromEntries(list.map((st) => [st.s, st]));
  for (const [title, list] of [["Corn stage reference", G.corn], ["Soybean stage reference", G.bean]]) {
    const start = gdu.indexOf(title), body = gdu.slice(start, gdu.indexOf("</table>", start));
    const rows = [...body.matchAll(/<tr[^>]*><td>([^<]+)<\/td><td>~(\d+)(?:&ndash;(\d+))?<\/td>/g)];
    assert.ok(rows.length >= 10, title);
    const m = byName(list);
    for (const [, s, lo, hi] of rows) {
      assert.ok(m[s], `${title}: ${s} is not in the shared table`);
      assert.equal(+lo, m[s].gdu, `${title} ${s}`);
      if (hi) assert.equal(+hi, m[s].hi, `${title} ${s} top`);
    }
  }
  // 1,020 GDU from planting: corn V12 (870), soybean R2 (1,000), on both pages.
  assert.equal(G.stageAt(G.corn, 1020).s, "V12");
  assert.equal(G.stageAt(G.bean, 1020).s, "R2");
  assert.equal(G.stageAt(G.corn, 100), null);
  assert.ok(!/from emergence/.test(html + js));
});

test("no em dashes in the new and changed files (reader-facing text; old code comments aside)", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const p of ["components/a2809.js", "components/gdu-stages.js", "components/fast-facts.js", "fast-facts.html"]) {
    const t = p.startsWith("components/a2809") || p.startsWith("components/gdu") ? read(p) : strip(read(p));
    assert.ok(!t.includes("\u2014"), p + " has an em dash");
    assert.ok(!t.includes("&mdash;"), p + " has an em dash entity");
  }
});

/* In the browser: the calculators show the hand-worked numbers. */
const PW = process.env.PLAYWRIGHT_PATH || "/home/user/node_modules/playwright/index.mjs";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
let chromium = null;
try { if (existsSync(PW)) ({ chromium } = await import(PW)); } catch (e) { chromium = null; }
const skip = !chromium || !existsSync(CHROME) ? "Playwright or Chromium not found here" : false;

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

test("the soil test, lime and GDU calculators show A2809's numbers in the browser", { skip }, async () => {
  const srv = await serve(), port = srv.address().port;
  let browser = null;
  try {
    browser = await chromium.launch({ executablePath: CHROME });
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const errors = [];
    pg.on("pageerror", (e) => errors.push(String(e)));
    await pg.route("**/*", (r) => r.request().url().startsWith(`http://127.0.0.1:${port}`) ? r.continue() : r.abort());
    await pg.goto(`http://127.0.0.1:${port}/fast-facts#pk`);
    await pg.waitForFunction(() => document.getElementById("st-pcat").textContent !== "-");
    const t = (id) => pg.textContent(id);
    assert.equal(await t("#st-pcat"), "High");
    assert.equal(await t("#st-kcat"), "Optimum");
    assert.equal(await t("#st-prec"), "40 lb/ac");
    assert.equal(await t("#st-krec"), "60 lb/ac");
    assert.match(await t("#st-note"), /demand level 1, loamy soil, corn grain 191–210 bu row/);
    // Alfalfa: the yield box turns to tons and resets to 5.
    await pg.selectOption("#st-crop", "alfalfa");
    assert.equal(await pg.inputValue("#st-yield"), "5");
    assert.equal(await t("#st-yield-unit"), "ton/ac");
    await pg.fill("#st-p", "20"); await pg.fill("#st-k", "120");
    assert.equal(await t("#st-prec"), "65 lb/ac");
    assert.equal(await t("#st-krec"), "300 lb/ac");
    assert.match(await t("#st-note"), /raise topdressed K₂O by 20%/);
    await pg.selectOption("#st-crop", "corn_silage");
    await pg.fill("#st-yield", "25");
    assert.equal(await t("#st-prec"), "80 lb/ac");
    assert.equal(await t("#st-krec"), "185 lb/ac");
    // Empty soil test: no number.
    await pg.fill("#st-k", "");
    assert.equal(await t("#st-krec"), "-");

    await pg.goto(`http://127.0.0.1:${port}/fast-facts#soilhealth`);
    await pg.waitForFunction(() => document.getElementById("lime-ag").textContent !== "-");
    assert.equal(await t("#lime-base"), "11 ton");
    assert.equal(await t("#lime-ag"), "8.5 ton");
    assert.equal(await t("#lime-cost"), "Type your $/ton to see cost");
    await pg.fill("#lime-price", "40");
    assert.equal(await t("#lime-cost"), "$340/ac at your $40/ton");          // 8.5 x 40
    await pg.selectOption("#lime-target", "6.3");
    assert.equal(await t("#lime-ag"), "1.5 ton");
    assert.equal(await t("#lime-cost"), "$60/ac at your $40/ton");           // 1.5 x 40
    await pg.selectOption("#lime-ni", "65");
    assert.equal(await t("#lime-ag"), "2 ton");
    await pg.fill("#lime-wph", "6.2");
    assert.equal(await t("#lime-cost"), "None needed");
    assert.match(await t("#lime-note"), /not more than 0\.2 below/);

    await pg.goto(`http://127.0.0.1:${port}/fast-facts#stages`);
    await pg.fill("#gdu-acc", "1000");
    await pg.fill("#gdu-max", "70"); await pg.fill("#gdu-min", "70");   // +20 GDU -> 1,020
    assert.equal(await t("#gdu-new"), "1020.0 GDU total");
    assert.equal(await t("#gdu-corn-stage"), "V12");
    assert.equal(await t("#gdu-bean-stage"), "R2");
    const marks = await pg.$$eval("#corn-sv-marks .sv-lbl", (els) => els.map((e) => e.textContent));
    assert.deepEqual(marks, [...G.corn].map((s) => s.s));
    assert.match(await t("#corn-sv-detail"), /~120 GDUs from planting/);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { if (browser) await browser.close(); srv.close(); }
});
