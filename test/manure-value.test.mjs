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
  assert.equal(M.bakeValues({ prices: [] })["unit-dairy_liq_4_11-1to3day"], "no quote");
});

test("per 1,000 gal and per ton, every type and timing", () => {
  const p = M.nutrientPrices(SEP1);
  const COL = { gt3day: 0, "1to3day": 1, lt1hr: 2 };
  for (const t of M.TYPES) for (const [tm, i] of Object.entries(COL)) {
    const want = t.n[i] * p.n + t.p * p.p + t.k * p.k;
    const u = M.perUnit(t.id, tm, p);
    near(u.total, want, `${t.id} ${tm}`);
    assert.equal(u.unit, t.liquid ? "1000gal" : "ton");
    near(M.perTon(t.id, tm, p), t.liquid ? want / 4.17 : want, `${t.id} ${tm} per ton`);
  }
  // dairy liquid 4-11% DM, worked in 1 hr to 3 days: 10 N, 6 P2O5, 17 K2O
  const v = M.bakeValues(SEP1);
  assert.equal(v["unit-dairy_liq_4_11-1to3day"], "$18.75");
  assert.equal(v["ton-dairy_liq_4_11-1to3day"], "$4.50");
  assert.equal(v["unit-dairy_liq_4_11-lt1hr"], "$20.03");
  assert.equal(v["unit-chicken_solid-1to3day"], "$61.24");   // 27 x .6413 + 35 x .9701 + 26 x .3833 = 17.32 + 33.95 + 9.97
});

test("the value of all the manure: N + P2O5 (N credited) + K2O, per unit, per ton, per acre and for the field", () => {
  const p = M.nutrientPrices(SEP1);
  for (const t of M.TYPES) for (const tm of M.TIMING) {
    const rate = t.liquid ? 5500 : 12, acres = 37;
    const r = M.fieldValue({ type: t.id, timing: tm.id, rate, acres, prices: p });
    const lb = { n: t.n[tm.i], p: t.p, k: t.k };
    const unit = lb.n * p.n + lb.p * p.p + lb.k * p.k;          // every nutrient counts
    const units = t.liquid ? rate / 1000 : rate;
    near(r.perUnit, unit, `${t.id} ${tm.id} per unit`);
    near(r.perTon, t.liquid ? unit / M.TONS_PER_KGAL : unit, `${t.id} ${tm.id} per ton`);
    near(r.perAcre, unit * units, `${t.id} ${tm.id} per acre`);
    near(r.field, unit * units * acres, `${t.id} ${tm.id} field`, 1e-6);
    for (const x of ["n", "p", "k"]) {
      near(r.lbAc[x], lb[x] * units, `${t.id} ${x} lb an acre`);
      near(r.usdAc[x], lb[x] * units * p[x], `${t.id} ${x} $ an acre`);
      near(r.usdField[x], lb[x] * units * p[x] * acres, `${t.id} ${x} $ field`, 1e-6);
    }
    near(r.usdAc.n + r.usdAc.p + r.usdAc.k, r.perAcre, `${t.id} parts add to the acre total`);
  }
  // no acres: the field is zero, the acre and unit values stand
  const z = M.fieldValue({ type: "beef_solid", timing: "lt1hr", rate: 10, acres: 0, prices: p });
  assert.equal(z.field, 0);
  near(z.perAcre, 10 * (5 * p.n + 6 * p.p + 10 * p.k), "beef solid an acre");
  // a missing quote is no value, never a partial one
  assert.deepEqual({ ...M.fieldValue({ ...M.EXAMPLE, prices: { n: p.n, p: p.p, k: null } }) }, { missing: true });
  assert.equal(M.deal, undefined, "the neighbor-sale math is gone");
});

test("the worked example: liquid dairy, worked in within 3 days, 6,000 gal/ac on 80 acres", () => {
  assert.deepEqual({ ...M.EXAMPLE }, { type: "dairy_liq_4_11", timing: "1to3day", rate: 6000, acres: 80 });
  const v = M.bakeValues(SEP1);
  // per 1,000 gal: 10 lb N x .6413, 6 lb P2O5 x .9701, 17 lb K2O x .3833
  assert.deepEqual([v["ex-n-unit"], v["ex-p-unit"], v["ex-k-unit"]], ["$6.41", "$5.82", "$6.52"]);
  assert.equal(v["ex-book"], "$18.75");
  assert.equal(v["ex-book-ton"], "$4.50");
  assert.deepEqual([v["ex-n-lb"], v["ex-p-lb"], v["ex-k-lb"]], ["60", "36", "102"]);
  assert.deepEqual([v["ex-n-ac"], v["ex-p-ac"], v["ex-k-ac"]], ["$38.48", "$34.92", "$39.10"]);
  assert.equal(v["ex-book-ac"], "$112.50");                       // 38.48 + 34.92 + 39.10
  assert.deepEqual([v["ex-n-field"], v["ex-p-field"], v["ex-k-field"]], ["$3,078", "$2,794", "$3,128"]);
  assert.equal(v["ex-field"], "$9,000");                          // 112.50 x 80
  for (const k of ["ex-buyer", "ex-ceil", "ex-floor", "ex-haul-ac"]) assert.ok(!(k in v), `${k} is gone`);
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
  assert.ok(mv.includes(`data-mv="unit-dairy_liq_4_11-1to3day">${live["unit-dairy_liq_4_11-1to3day"]}<`));
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

test("Use my manure test: typed pounds replace the book pounds, every pound priced", () => {
  const p = M.nutrientPrices(SEP1);
  // A dairy liquid test of 28 lb N, 13 lb P2O5, 25 lb K2O per 1,000 gal:
  // 28 x .6413 + 13 x .9701 + 25 x .3833 = 17.96 + 12.61 + 9.58 = 40.15
  const u = M.perUnit("dairy_liq_4_11", "1to3day", p, { n: 28, p: 13, k: 25 });
  assert.equal(M.money(u.total), "$40.15");
  assert.deepEqual({ ...u.lb }, { n: 28, p: 13, k: 25 });
  assert.deepEqual({ ...u.fromTest }, { n: true, p: true, k: true });
  // 6,000 gal on 80 acres: 40.15 x 6 x 80 = 19,273; a ton is 40.15 / 4.17 = 9.63
  const f = M.fieldValue({ ...M.EXAMPLE, prices: p, test: { n: "28", p: "13", k: "25" } });
  assert.equal(M.money(f.field, 0), "$19,273");
  assert.equal(M.money(f.perTon), "$9.63");
  // Only K typed: N and P stay on the book (10, 6), K is 20: 6.41 + 5.82 + 7.67 = 19.90
  const k = M.perUnit("dairy_liq_4_11", "1to3day", p, { n: "", p: null, k: 20 });
  assert.equal(M.money(k.total), "$19.90");
  assert.deepEqual({ ...k.fromTest }, { n: false, p: false, k: true });
  // Blank, junk or negative boxes are no test at all
  assert.equal(M.cleanTest({ n: "", p: "", k: "" }), null);
  assert.equal(M.cleanTest({ n: -3, p: "abc", k: null }), null);
  assert.equal(M.money(M.perUnit("dairy_liq_4_11", "1to3day", p, { n: "", p: "", k: "" }).total), "$18.75");
  // A zero is a real test result, not a blank
  assert.equal(M.cleanTest({ n: 0 }).n, 0);
  // The calculator has the three boxes
  const js = read("components/manure-value.js");
  for (const k2 of ["tn", "tp", "tk"]) assert.ok(js.includes(`data-k="${k2}"`), `test box ${k2}`);
  assert.ok(js.includes("Use my manure test"));
});

test("the words match the numbers: book pounds are first-year, never called all of it", () => {
  const mv = read("manure-value.html");
  const vis = mv.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ");
  assert.ok(!/value of all the manure: all its P and K/i.test(mv), "the old 'all of it' claim is back");
  assert.ok(!/full value of those nutrients at today/i.test(mv));
  assert.match(vis, /book pounds for what a crop can use the first year, not everything in the manure/);
  assert.match(vis, /First-year value: <span data-mv="ex-field">/);
  assert.ok(FAQ.some(([q, a]) => q === "Is this the value of all the nutrients in the manure?" && /^No\./.test(a)));
  assert.ok(!FAQ.some(([q]) => /charge a neighbor/i.test(q)), "no neighbor-pricing question");
  assert.ok(!/id="selling"|Selling manure to a neighbor/.test(mv), "the neighbor section is folded into the rules");
  const ff = read("fast-facts.html");
  assert.ok(!/value of all the N, P/.test(ff), "fast-facts calls first-year pounds all of it");
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
