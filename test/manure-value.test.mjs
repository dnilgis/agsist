/* What manure is worth (components/manure-value.js), the /manure-value page
 * and the Manure tab on /fast-facts.
 *
 * The shipped file runs in a bare context (no document), which loads only its
 * pure parts, so a green run checks the copy the browser runs.
 *
 *   node --test test/manure-value.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { bakeManurePage, bakeFastFacts, FAQ } from "../scripts/bake_manure_value.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/manure-value.js", "utf8"), ctx);
const M = ctx.window.AgManure;
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const read = (f) => readFileSync(ROOT + f, "utf8");

/* The 2026-09-01 dealer sheet, fixed here so the hand-worked answers below
   do not move when prices do. */
const SEP1 = { updated: "2026-09-01", prices: [
  { name: "Urea", symbol: "46-0-0", price: 590, as_of: "2026-09-01" },
  { name: "Potash", symbol: "0-0-60", price: 460, as_of: "2026-09-01" },
  { name: "MAP + Sulfur", symbol: "12-40-0-10S", price: 930, as_of: "2026-09-01" },
  { name: "Amm. Sulfate", symbol: "21-0-0-24S", price: 460, as_of: "2026-09-01" },
] };

test("N, P2O5 and K2O $/lb, by hand", () => {
  const p = M.nutrientPrices(SEP1);
  near(p.n, 590 / 920, "N = urea / (2000 x 0.46)");                 // 0.6413
  near(p.k, 460 / 1200, "K2O = potash / (2000 x 0.60)");            // 0.3833
  near(p.pRaw, 930 / 800, "raw P2O5 = MAP / 800 lb");                // 1.1625
  near(p.mapNcredit, 240 * 590 / 920, "MAP N credit = 240 lb x N $/lb"); // 153.91
  near(p.p, (930 - 240 * 590 / 920) / 800, "P2O5 = (MAP - N credit) / 800"); // 0.9701
  assert.equal(M.money(p.p), "$0.97");
  assert.equal(M.money(p.pRaw), "$1.16");
});

test("the live file: P credits MAP's N at the live urea price, K from potash", () => {
  const d = JSON.parse(read("data/fertilizer.json"));
  const by = (n) => d.prices.find((x) => x.name === n);
  const p = M.nutrientPrices(d);
  const n = by("Urea").price / 920;
  near(p.n, n, "N");
  near(p.p, (by("MAP + Sulfur").price - 240 * n) / 800, "P2O5 with N credit");
  near(p.k, by("Potash").price / 1200, "K2O");
  assert.ok(p.p < p.pRaw, "crediting N must lower the P price");
  assert.equal(p.src.n.as_of, by("Urea").as_of, "each price carries its own date");
});

test("a missing quote is no price, never zero", () => {
  const p = M.nutrientPrices({ prices: [{ name: "MAP + Sulfur", symbol: "12-40-0-10S", price: 930 }] });
  assert.equal(p.n, null);
  assert.equal(p.p, null, "no urea price, no N credit, so no P price rather than a guess");
  assert.equal(p.k, null);
  const u = M.perUnit("dairy_liq_4_11", "1to3day", p);
  assert.equal(u.total, null);
  assert.equal(u.fy.total, null);
  const v = M.bakeValues({ prices: [] });
  assert.equal(v["all-dairy_liq_4_11"], "no quote");
  assert.equal(v["fy-dairy_liq_4_11-1to3day"], "no quote");
  assert.equal(v["ex-all-field"], "no quote");
});

/* UW Extension A2809 (R-11-2012; the copy UW posted March 2026), chapter 9,
   copied by hand from the table text (pdftotext -layout and -raw agree row
   for row). [Table 9.2 total N, P2O5, K2O], [Table 9.3 first-year N by
   timing], 9.3 P2O5, 9.3 K2O, [Table 9.1 first-year N %]. */
const A2809 = {
  dairy_solid_gt20:  ["Dairy: solid (> 20.0% DM)",          [9, 4, 7],    [2, 3, 3],    3,  6,  [25, 30, 35]],
  dairy_solid_11_20: ["Dairy: semi-solid (11.1-20.0% DM)",  [8, 4, 6],    [2, 2, 3],    3,  5,  [25, 30, 35]],
  dairy_liq_4_11:    ["Dairy: slurry (4.1-11.0% DM)",       [24, 8, 21],  [7, 10, 12],  6,  17, [30, 40, 50]],
  dairy_liq_lt4:     ["Dairy: liquid (< 4.0% DM)",          [14, 4, 14],  [4, 6, 7],    3,  11, [30, 40, 50]],
  beef_solid:        ["Beef, solid",                        [13, 8, 12],  [3, 4, 5],    6,  10, [25, 30, 35]],
  beef_liq:          ["Beef, liquid",                       [16, 7, 15],  [5, 6, 8],    6,  12, [30, 40, 50]],
  swine_solid:       ["Swine, solid",                       [18, 13, 10], [7, 9, 12],   10, 8,  [40, 50, 65]],
  swine_liq_fin_in:  ["Swine: finish (indoor pit)",         [43, 18, 28], [17, 22, 28], 14, 22, [40, 50, 65]],
  swine_liq_fin_out: ["Swine: finish (outdoor pit)",        [18, 7, 10],  [7, 9, 12],   6,  8,  [40, 50, 65]],
  chicken_solid:     ["Poultry: chicken",                   [49, 44, 33], [24, 27, 29], 35, 26, [50, 55, 60]],
  turkey_solid:      ["Poultry: turkey",                    [51, 44, 31], [26, 28, 31], 35, 25, [50, 55, 60]],
  horse_solid:       ["Horse",                              [10, 6, 8],   [2, 3, 4],    5,  6,  [25, 30, 35]],
};

test("every type's pounds match A2809 Tables 9.1, 9.2 and 9.3, and 9.3 is 9.2 times 9.1", () => {
  assert.deepEqual([...M.TYPES.map((t) => t.id)].sort(), Object.keys(A2809).sort(), "the 12 types");
  assert.equal(M.PK_PCT, 80, "Table 9.1: P2O5 and K2O are 80% available the first year, every species (not 60%)");
  for (const t of M.TYPES) {
    const [, tot, n, p, k, pct] = A2809[t.id];
    assert.deepEqual([...t.tot], tot, `${t.id} Table 9.2 total`);
    assert.deepEqual([...t.n], n, `${t.id} Table 9.3 first-year N`);
    assert.equal(t.p, p, `${t.id} Table 9.3 P2O5`);
    assert.equal(t.k, k, `${t.id} Table 9.3 K2O`);
    assert.deepEqual([...t.nPct], pct, `${t.id} Table 9.1 N %`);
    // UW built 9.3 as 9.2 x 9.1 and rounded; every cell is within half a pound
    t.nPct.forEach((x, i) => assert.ok(Math.abs(t.tot[0] * x / 100 - t.n[i]) <= 0.5, `${t.id} N ${i}: ${t.tot[0]} x ${x}% vs ${t.n[i]}`));
    assert.ok(Math.abs(t.tot[1] * 0.8 - t.p) <= 0.5, `${t.id} P: ${t.tot[1]} x 80% vs ${t.p}`);
    assert.ok(Math.abs(t.tot[2] * 0.8 - t.k) <= 0.5, `${t.id} K: ${t.tot[2]} x 80% vs ${t.k}`);
    assert.equal(t.n2, Math.round(t.tot[0] * 0.10), `${t.id} second-year N is 10% of total`);
    assert.ok(t.tot.every((x, i) => x >= [t.n[2], t.p, t.k][i]), `${t.id} total is never below first year`);
  }
});

test("per 1,000 gal and per ton, every type and timing: all the nutrients, and the first-year part", () => {
  const p = M.nutrientPrices(SEP1);
  const COL = { gt3day: 0, "1to3day": 1, lt1hr: 2 };
  for (const t of M.TYPES) for (const [tm, i] of Object.entries(COL)) {
    const all = t.tot[0] * p.n + t.tot[1] * p.p + t.tot[2] * p.k;
    const fy = t.n[i] * p.n + t.p * p.p + t.k * p.k;
    const u = M.perUnit(t.id, tm, p);
    near(u.total, all, `${t.id} ${tm} all`);
    near(u.fy.total, fy, `${t.id} ${tm} first year`);
    assert.ok(u.total > u.fy.total, `${t.id} ${tm}: all of it is worth more than the first-year part`);
    assert.equal(u.unit, t.liquid ? "1000gal" : "ton");
    near(M.perTon(t.id, tm, p), t.liquid ? all / 4.17 : all, `${t.id} ${tm} per ton`);
  }
  const v = M.bakeValues(SEP1);
  // dairy liquid 4-11% DM, all of it: 24 x .641304 + 8 x .970109 + 21 x .383333 = 15.391 + 7.761 + 8.050 = 31.20
  assert.equal(v["all-dairy_liq_4_11"], "$31.20");
  assert.equal(v["all-ton-dairy_liq_4_11"], "$7.48");             // 31.202 / 4.17
  // the first-year part: 10 N, 6 P2O5, 17 K2O worked in 1 hr to 3 days
  assert.equal(v["fy-dairy_liq_4_11-1to3day"], "$18.75");
  assert.equal(v["fy-ton-dairy_liq_4_11-1to3day"], "$4.50");
  assert.equal(v["fy-dairy_liq_4_11-lt1hr"], "$20.03");
  assert.equal(v["fy-dairy_liq_4_11-gt3day"], "$16.83");
  // chicken: 49 x .641304 + 44 x .970109 + 33 x .383333 = 31.42 + 42.68 + 12.65
  assert.equal(v["all-chicken_solid"], "$86.76");
  assert.equal(v["fy-chicken_solid-1to3day"], "$61.24");          // 27 N, 35 P2O5, 26 K2O
  // hog finishing indoor pit: 43 x .641304 + 18 x .970109 + 28 x .383333 = 27.58 + 17.46 + 10.73
  assert.equal(v["all-swine_liq_fin_in"], "$55.77");
  // solid dairy over 20% DM: 9 x .641304 + 4 x .970109 + 7 x .383333 = 5.77 + 3.88 + 2.68
  assert.equal(v["all-dairy_solid_gt20"], "$12.34");
  assert.equal(v["all-ton-dairy_solid_gt20"], "$12.34", "solid is already per ton");
});

test("the value of all the manure: N + P2O5 (N credited) + K2O, per unit, per ton, per acre and for the field", () => {
  const p = M.nutrientPrices(SEP1);
  for (const t of M.TYPES) for (const tm of M.TIMING) {
    const rate = t.liquid ? 5500 : 12, acres = 37;
    const r = M.fieldValue({ type: t.id, timing: tm.id, rate, acres, prices: p });
    const units = t.liquid ? rate / 1000 : rate;
    for (const [part, lb] of [[r, { n: t.tot[0], p: t.tot[1], k: t.tot[2] }], [r.fy, { n: t.n[tm.i], p: t.p, k: t.k }]]) {
      const unit = lb.n * p.n + lb.p * p.p + lb.k * p.k;          // every nutrient counts
      const tag = `${t.id} ${tm.id} ${part === r ? "all" : "fy"}`;
      near(part.perUnit, unit, `${tag} per unit`);
      near(part.perTon, t.liquid ? unit / M.TONS_PER_KGAL : unit, `${tag} per ton`);
      near(part.perAcre, unit * units, `${tag} per acre`);
      near(part.field, unit * units * acres, `${tag} field`, 1e-6);
      for (const x of ["n", "p", "k"]) {
        near(part.lbAc[x], lb[x] * units, `${tag} ${x} lb an acre`);
        near(part.usdAc[x], lb[x] * units * p[x], `${tag} ${x} $ an acre`);
        near(part.usdField[x], lb[x] * units * p[x] * acres, `${tag} ${x} $ field`, 1e-6);
      }
      near(part.usdAc.n + part.usdAc.p + part.usdAc.k, part.perAcre, `${tag} parts add to the acre total`);
    }
  }
  // no acres: the field is zero, the acre and unit values stand
  const z = M.fieldValue({ type: "beef_solid", timing: "lt1hr", rate: 10, acres: 0, prices: p });
  assert.equal(z.field, 0);
  near(z.perAcre, 10 * (13 * p.n + 8 * p.p + 12 * p.k), "beef solid an acre, all of it");
  near(z.fy.perAcre, 10 * (5 * p.n + 6 * p.p + 10 * p.k), "beef solid an acre, first year");
  // the total does not depend on how fast it is worked in; the first-year part does
  const a = M.fieldValue({ ...M.EXAMPLE, timing: "gt3day", prices: p }), b = M.fieldValue({ ...M.EXAMPLE, timing: "lt1hr", prices: p });
  near(a.perUnit, b.perUnit, "all of it, any timing");
  assert.ok(b.fy.perUnit > a.fy.perUnit, "worked in fast, the crop gets more N");
  // a missing quote is no value, never a partial one
  assert.deepEqual({ ...M.fieldValue({ ...M.EXAMPLE, prices: { n: p.n, p: p.p, k: null } }) }, { missing: true });
  assert.equal(M.deal, undefined, "the neighbor-sale math is gone");
});

test("the worked example: liquid dairy, 6,000 gal/ac on 80 acres, all of it and the first-year part", () => {
  assert.deepEqual({ ...M.EXAMPLE }, { type: "dairy_liq_4_11", timing: "1to3day", rate: 6000, acres: 80 });
  const v = M.bakeValues(SEP1);
  // per 1,000 gal: 24 lb N x .641304, 8 lb P2O5 x .970109, 21 lb K2O x .383333
  assert.deepEqual([v["ex-n-unit"], v["ex-p-unit"], v["ex-k-unit"]], ["$15.39", "$7.76", "$8.05"]);
  assert.equal(v["ex-all"], "$31.20");
  assert.equal(v["ex-all-ton"], "$7.48");
  assert.deepEqual([v["ex-n-lb"], v["ex-p-lb"], v["ex-k-lb"]], ["144", "48", "126"]);   // x 6
  assert.deepEqual([v["ex-n-ac"], v["ex-p-ac"], v["ex-k-ac"]], ["$92.35", "$46.57", "$48.30"]);
  assert.equal(v["ex-all-ac"], "$187.21");                         // 31.2022 x 6
  assert.deepEqual([v["ex-n-field"], v["ex-p-field"], v["ex-k-field"]], ["$7,388", "$3,725", "$3,864"]);
  assert.equal(v["ex-all-field"], "$14,977");                      // 187.213 x 80
  // first year, worked in 1 hr to 3 days: 10 N, 6 P2O5, 17 K2O per 1,000 gal
  assert.deepEqual([v["ex-fy-n-lb"], v["ex-fy-p-lb"], v["ex-fy-k-lb"]], ["60", "36", "102"]);
  assert.equal(v["ex-fy"], "$18.75");
  assert.equal(v["ex-fy-ac"], "$112.50");
  assert.equal(v["ex-fy-field"], "$9,000");
  for (const k of ["ex-buyer", "ex-ceil", "ex-floor", "ex-haul-ac", "ex-book"]) assert.ok(!(k in v), `${k} is gone`);
});

test("no buyer-needs discount, fair range or hauling left on the pages or in the calculator", () => {
  const js = read("components/manure-value.js");
  assert.ok(!/buyerNeeds|sellerUses|data-role="sell"|soil test calls for|Worth to the buyer|Fair price|data-k="haul"|data-k="who"/.test(js));
  for (const f of ["manure-value.html", "fast-facts.html", "scripts/bake_manure_value.mjs"]) {
    const s = read(f);
    assert.ok(!/fair range|neighbor should pay|Worth to this buyer|saves him nothing|Less than the book value/i.test(s), `${f} still prices a discount`);
  }
});

test("the HTML carries today's numbers (bake is current) and the tables come from the one data copy", () => {
  const data = JSON.parse(read("data/fertilizer.json"));
  const mv = read("manure-value.html");
  assert.equal(bakeManurePage(mv, M, data), mv, "manure-value.html is stale: node scripts/bake_manure_value.mjs");
  const ff = read("fast-facts.html");
  assert.equal(bakeFastFacts(ff, M), ff, "fast-facts.html manure table is stale: node scripts/bake_manure_value.mjs");
  const live = M.bakeValues(data);
  assert.ok(mv.includes(`data-mv="all-dairy_liq_4_11">${live["all-dairy_liq_4_11"]}<`));
  assert.ok(mv.includes(`data-mv="fy-dairy_liq_4_11-1to3day">${live["fy-dairy_liq_4_11-1to3day"]}<`));
  // Both pounds tables (this page and Fast Facts) carry every type's totals and first-year pounds
  for (const [f, s] of [["manure-value.html", mv], ["fast-facts.html", ff]]) {
    for (const t of M.TYPES) {
      const unit = t.liquid ? "lb/1,000 gal" : "lb/ton";
      const row = `<td class="tl">${t.label} (${unit})</td>` + t.tot.map((x) => `<td class="hi">${x}</td>`).join("") +
        t.n.map((n) => `<td>${n} [${t.n2}]</td>`).join("") + `<td>${t.p}</td><td>${t.k}</td>`;
      assert.ok(s.includes(row), `${f}: pounds row for ${t.id}`);
    }
  }
  // The hero's pounds are the dairy slurry row of Table 9.2
  const d = M.type("dairy_liq_4_11");
  assert.ok(mv.includes(`(${d.tot[0]} lb N, ${d.tot[1]} lb P&#8322;O&#8325; and ${d.tot[2]} lb K&#8322;O per 1,000 gallons, Table 9.2)`));
});

function faqCheck(file) {
  const src = read(file);
  const vis = src.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;/g, "\u2019").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
  const pairs = [];
  for (const m of src.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const walk = (o) => { if (!o || typeof o !== "object") return; if (o["@type"] === "FAQPage") for (const q of o.mainEntity) pairs.push([q.name, q.acceptedAnswer.text]); Object.values(o).forEach(walk); };
    walk(JSON.parse(m[1]));
  }
  assert.ok(pairs.length >= 4, `${file}: FAQPage has ${pairs.length} questions`);
  for (const [q, a] of pairs) {
    const n = (s) => s.replace(/\s+/g, " ").trim();
    assert.ok(vis.includes(n(q)), `${file}: question not visible word for word: ${q}`);
    assert.ok(vis.includes(n(a)), `${file}: answer not visible word for word: ${a.slice(0, 80)}`);
  }
  return pairs;
}

test("FAQPage JSON-LD matches the visible FAQ word for word", () => {
  const pairs = faqCheck("manure-value.html");
  assert.equal(pairs.length, FAQ.length);
  faqCheck("fast-facts.html");
});

test("Fast Facts: every tab has an address, a panel and a contents link, and the hash opens it", () => {
  const ff = read("fast-facts.html");
  const tabs = [...ff.matchAll(/<button id="tab-btn-([a-z]+)"[^>]*data-tab="([a-z]+)"/g)];
  assert.ok(tabs.length >= 10, "tabs found");
  for (const [, id, dt] of tabs) {
    assert.equal(id, dt);
    assert.ok(ff.includes(`id="tab-${id}" role="tabpanel"`), `panel for ${id} is in the HTML`);
    assert.ok(ff.includes(`<a href="#${id}">`), `contents list links #${id}`);
  }
  const js = read("components/fast-facts.js");
  assert.match(js, /addEventListener\('hashchange'/, "a hash change on the page opens the tab");
  assert.match(js, /getElementById\('tab-btn-'\+h\)/, "the hash names the tab button");
  assert.match(js, /history\.replaceState\(null,'','#'\+b\.dataset\.tab\)/, "clicking a tab writes its address");
  // The tab text is in the page for search, not fetched later.
  assert.ok(ff.includes("Available Nutrient Content by Manure Type"));
  assert.ok(ff.includes("Economic Thresholds: Key Insects"));
});

test("one calculator copy: both pages load components/manure-value.js and nothing else carries the table", () => {
  for (const f of ["manure-value.html", "fast-facts.html"]) {
    const s = read(f);
    assert.ok(s.includes('src="/components/manure-value.js?v='), `${f} loads the shared calculator`);
    assert.ok(s.includes("data-mv-calc"), `${f} has a calculator mount`);
    assert.ok(!/MANURE_DATA|function updateMV|id="mv-n-price"/.test(s), `${f} has its own manure calculator`);
  }
  // The A2809 numbers object lives in one file only.
  const tell = /dairy_liq_4_11['"]?\s*[:,]\s*\{?\s*(?:id|n)\b|n:\s*\[7,\s*10,\s*12\]|lt1hr:12,f1to3day:10/;
  const hits = [];
  for (const dir of ["", "components/"]) for (const f of readdirSync(ROOT + dir)) {
    if (!/\.(html|js)$/.test(f)) continue;
    if (tell.test(read(dir + f))) hits.push(dir + f);
  }
  assert.deepEqual(hits, ["components/manure-value.js"]);
});

test("Use my manure test: typed total pounds replace the book pounds, every pound priced", () => {
  const p = M.nutrientPrices(SEP1);
  // A dairy liquid test of 28 lb N, 13 lb P2O5, 25 lb K2O per 1,000 gal:
  // 28 x .6413 + 13 x .9701 + 25 x .3833 = 17.96 + 12.61 + 9.58 = 40.15
  const u = M.perUnit("dairy_liq_4_11", "1to3day", p, { n: 28, p: 13, k: 25 });
  assert.equal(M.money(u.total), "$40.15");
  assert.deepEqual({ ...u.lb }, { n: 28, p: 13, k: 25 });
  assert.deepEqual({ ...u.fromTest }, { n: true, p: true, k: true });
  // First year from a test is the test times A2809 Table 9.1: dairy liquid N 40% (1 hr to 3 days), P and K 80%
  // 11.2 x .6413 + 10.4 x .9701 + 20 x .3833 = 7.18 + 10.09 + 7.67 = 24.94
  assert.deepEqual({ ...u.fy.lb }, { n: 28 * 0.4, p: 13 * 0.8, k: 25 * 0.8 });
  assert.equal(M.money(u.fy.total), "$24.94");
  // 6,000 gal on 80 acres: 40.15 x 6 x 80 = 19,273; a ton is 40.15 / 4.17 = 9.63
  const f = M.fieldValue({ ...M.EXAMPLE, prices: p, test: { n: "28", p: "13", k: "25" } });
  assert.equal(M.money(f.field, 0), "$19,273");
  assert.equal(M.money(f.perTon), "$9.63");
  assert.equal(M.money(f.fy.field, 0), "$11,970");                  // 24.938 x 6 x 80 = 11,970.4
  // Only K typed: N and P stay on the book totals (24, 8), K is 20: 15.39 + 7.76 + 7.67 = 30.82
  const k = M.perUnit("dairy_liq_4_11", "1to3day", p, { n: "", p: null, k: 20 });
  assert.equal(M.money(k.total), "$30.82");
  assert.deepEqual({ ...k.fromTest }, { n: false, p: false, k: true });
  assert.deepEqual({ ...k.fy.lb }, { n: 10, p: 6, k: 16 }, "book first-year N and P, test K x 80%");
  // Blank, junk or negative boxes are no test at all
  assert.equal(M.cleanTest({ n: "", p: "", k: "" }), null);
  assert.equal(M.cleanTest({ n: -3, p: "abc", k: null }), null);
  assert.equal(M.money(M.perUnit("dairy_liq_4_11", "1to3day", p, { n: "", p: "", k: "" }).total), "$31.20");
  // A zero is a real test result, not a blank
  assert.equal(M.cleanTest({ n: 0 }).n, 0);
  // The calculator has the three boxes and asks for total pounds
  const js = read("components/manure-value.js");
  for (const k2 of ["tn", "tp", "tk"]) assert.ok(js.includes(`data-k="${k2}"`), `test box ${k2}`);
  assert.ok(js.includes("Use my manure test"));
  assert.ok(js.includes("Type the total pounds from your lab report"));
});

test("the words match the numbers: the headline is all the nutrients, the first-year part beside it", () => {
  const mv = read("manure-value.html");
  const vis = mv.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ");
  // The big number is the value of all of it, the first-year number beside it
  assert.match(mv, /<span class="mv-k">All the nutrients<\/span><span class="mv-num"><span data-mv="all-dairy_liq_4_11">/);
  assert.match(mv, /<span class="mv-k">What the crop can use the first year<\/span><span class="mv-num2"><span data-mv="fy-dairy_liq_4_11-1to3day">/);
  assert.match(vis, /All the nutrients: <span data-mv="ex-all-field">/);
  assert.match(vis, /Table 9\.2/);
  assert.match(vis, /R-11-2012/);
  assert.ok(!/not everything in the manure|so all of it is worth more|First-year value, UW book pounds/.test(mv + read("components/manure-value.js")),
    "old first-year-only headline words are back");
  assert.ok(FAQ.some(([q, a]) => q === "Is this the value of all the nutrients in the manure?" && /^Yes\./.test(a)));
  assert.ok(!FAQ.some(([q]) => /charge a neighbor/i.test(q)), "no neighbor-pricing question");
  assert.ok(!/id="selling"|Selling manure to a neighbor/.test(mv), "the neighbor section is folded into the rules");
  // meta description leads with all of it
  const desc = mv.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.match(desc, /all the N, P and K in liquid dairy manure is worth about \$[\d.]+ per 1,000 gal/);
  assert.ok(desc.length <= 170, `description ${desc.length} chars`);
  // The share card says the same number
  assert.match(mv, /og:image:alt"\s+content="All the nutrients in liquid dairy manure are worth \$[\d.]+ per 1,000 gallons/);
  // Fast Facts: the tab table and its FAQ count all of it
  const ff = read("fast-facts.html");
  assert.ok(!/Multiply the first-year available N/.test(ff), "fast-facts FAQ still prices first-year pounds only");
  assert.ok(ff.includes("Multiply the total N, P2O5 and K2O in each ton or 1,000 gallons"));
  assert.ok(ff.includes("Total and Available Nutrient Content by Manure Type"));
});

test("prices carry their quote date, never 'today's'", () => {
  for (const f of ["manure-value.html", "fast-facts.html"]) {
    const s = read(f).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ");
    const hit = s.match(/[^.>]{0,30}today(?:&rsquo;|'|’)s (?:fertilizer )?prices[^.<]{0,20}/i);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
  const mv = read("manure-value.html");
  const data = JSON.parse(read("data/fertilizer.json"));
  const when = M.day(M.nutrientPrices(data).src.n.as_of);
  assert.ok(mv.includes(`<h1>What manure is worth at <span data-mv="asof-n">${when}</span> fertilizer prices</h1>`), "the H1 names the quote date");
});
