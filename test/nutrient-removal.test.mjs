/* /nutrient-removal: P and K removal in dollars.
 *
 * Pounds: UW Extension A2809 Table 4.2 (references branch, refs/uw-a2809-2026.txt).
 * Prices: data/fertilizer-prices.json only, the same per_lb pick /fertilizer and Fast Facts show.
 * Every expected number below is worked by hand from those two. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const NR = require("../components/nutrient-removal.js");
const html = readFileSync(ROOT + "nutrient-removal.html", "utf8");
// The page may write P2O5 as P&#8322;O&#8325; or with subscript characters (the
// freshness bake does); the arithmetic checks read all three the same.
const plain = html.replace(/&#8322;|\u2082/g, "2").replace(/&#8325;|\u2085/g, "5");
const js = readFileSync(ROOT + "components/nutrient-removal.js", "utf8");
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

/* A2809 Table 4.2, lb per unit of yield: [P2O5, K2O, basis, moisture]. */
const A2809 = {
  corn_grain: [0.38, 0.29, "bu", 15.5], corn_silage: [3.6, 8.3, "wet", 65], corn_stover: [4.6, 32, "dm"],
  soy_grain: [0.8, 1.4, "bu", 13], soy_straw: [5.4, 19, "dm"],
  wheat_grain: [0.5, 0.35, "bu", 13.5], wheat_straw: [6, 28, "dm"],
  oat_grain: [0.29, 0.19, "bu", 14], oat_straw: [9.4, 47, "dm"],
  barley_grain: [0.4, 0.35, "bu", 14.5], barley_straw: [10, 32, "dm"], sg_silage: [11, 44, "dm"],
  alfalfa: [13, 60, "dm"], red_clover: [13, 60, "dm"], grass_hay: [15, 55, "dm"],
  mixed_hay_hi: [13, 60, "dm"], mixed_hay_lo: [13, 51, "dm"],
};

/* A small price list shaped like data/fertilizer-prices.json. */
const FIX = { prices: [
  { key: "urea", name: "Urea", symbol: "46-0-0", price: 620, as_of: "2026-10-06", src_label: "Test co-ops, Oct 6" },
  { key: "anhydrous", name: "Anhydrous ammonia", symbol: "82-0-0", price: 820, as_of: "2026-10-06", src_label: "Test co-ops, Oct 6" },
  { key: "dap", name: "DAP", symbol: "18-46-0", price: 920, as_of: "2026-10-06", src_label: "Test co-ops, Oct 6" },
  { key: "map", name: "MAP", symbol: "11-52-0", price: 1000, as_of: "2026-10-12", src_label: "Test co-ops, Oct 12" },
  { key: "potash", name: "Potash", symbol: "0-0-60", price: 480, as_of: "2026-10-06", src_label: "Test co-ops, Oct 6" },
  { key: "ams", name: "AMS", symbol: "21-0-0-24S", price: 500, as_of: "2026-09-24", src_label: "Test co-op, Sep 24" },
] };

test("every crop's pounds match A2809 Table 4.2", () => {
  assert.deepEqual(NR.CROPS.map((c) => c.id).sort(), Object.keys(A2809).sort());
  for (const c of NR.CROPS) {
    const [p, k, basis, moist] = A2809[c.id];
    assert.equal(c.p, p, c.id + " P2O5");
    assert.equal(c.k, k, c.id + " K2O");
    assert.equal(c.basis, basis, c.id + " basis");
    if (moist != null) assert.equal(c.moist, moist, c.id + " moisture");
    assert.ok(c.def > 0 && c.defWhy, c.id + " has a starting yield and says where it comes from");
  }
});

test("no N or S removal is filled in until a source for it is read", () => {
  for (const c of NR.CROPS) {
    assert.equal(c.n, null, c.id + " N");
    assert.equal(c.s, null, c.id + " S");
  }
});

/* The shared pick (data/fertilizer-prices.json per_lb, /fertilizer, Fast Facts):
   N = urea 620 / 920 = 0.673913; P = MAP (1000 - 220 x 0.673913) / 1040
   = (1000 - 148.26087) / 1040 = 851.73913 / 1040 = 0.818980; K = 480 / 1200 = 0.40 */
const PU = 620 / 920, PP = (1000 - 220 * PU) / 1040;

test("prices: the shared pick, urea for N, MAP with urea N credit for P, potash for K (hand-worked)", () => {
  const pr = NR.nutrientPrices(FIX);
  assert.equal(pr.n.row.key, "urea", "urea, even though anhydrous is cheaper per lb N here");
  assert.ok(near(pr.n.usd, 0.673913, 1e-6));
  assert.equal(pr.p.row.key, "map", "MAP, even though DAP is cheaper after credit here");
  assert.ok(near(pr.p.usd, 0.818980, 1e-6));
  assert.ok(near(pr.p.credit, 148.26087, 1e-5));
  assert.equal(pr.k.row.key, "potash");
  assert.ok(near(pr.k.usd, 0.4));
});

test("prices: no MAP price falls back to DAP, credited at urea", () => {
  const pr = NR.nutrientPrices({ prices: FIX.prices.filter((p) => p.key !== "map") });
  // (920 - 360 x 0.673913) / 920 = (920 - 242.6087) / 920 = 0.736295
  assert.equal(pr.p.row.key, "dap");
  assert.ok(near(pr.p.usd, 0.736295, 1e-6));
});

test("prices: the live file gives exactly the per_lb numbers the other pages show", () => {
  const data = JSON.parse(readFileSync(ROOT + "data/fertilizer-prices.json", "utf8"));
  const pr = NR.nutrientPrices(data);
  for (const x of ["n", "p", "k"]) {
    assert.ok(data.per_lb[x], x + " in per_lb");
    assert.equal(pr[x].row.key, data.per_lb[x].from, x + " same product");
    assert.ok(near(pr[x].usd, data.per_lb[x].usd, 0.00006), x + " same $/lb (per_lb is rounded to 4 places)");
    assert.equal(pr[x].row.as_of, data.per_lb[x].as_of);
  }
});

test("corn stalks: other guides beside A2809, hand-worked", () => {
  const st = NR.crop("corn_stover");
  assert.deepEqual(st.alt.map((x) => x.id), ["a2809", "isu", "purdue"]);
  const isu = NR.source(st, "isu"), pu = NR.source(st, "purdue");
  // ISU PM 1688 via ICM: 4.8 and 18.0 a ton at 15% moisture -> / 0.85 for a dry ton
  assert.ok(near(isu.p, 5.647059, 1e-6) && near(isu.k, 21.176471, 1e-6));
  assert.ok(near(pu.p, 3.6) && near(pu.k, 20));
  assert.equal(NR.source(st, "nope").id, "a2809", "unknown source falls back to A2809");
  assert.equal(NR.source(NR.crop("wheat_straw"), "isu"), null, "straw has only A2809 read");
  const pr = NR.nutrientPrices(FIX);
  // Purdue: 3.6 x 0.818980 + 20 x 0.4 = 2.948328 + 8 = 10.948328
  const r = NR.cropLine({ crop: "corn_stover", src: "purdue", yield: 3, acres: 10 }, pr);
  assert.ok(near(r.perUnit.pk, 10.948328, 1e-5));
  assert.ok(near(r.lbAc.k, 60) && near(r.perAc, 3 * 10.948328, 1e-4));
  // spread: low Purdue 10.948, high A2809 4.6 x 0.818980 + 12.8 = 16.567308
  assert.equal(r.spread.lo.src.id, "purdue");
  assert.equal(r.spread.hi.src.id, "a2809");
  assert.ok(near(r.spread.hi.usd, 16.567308, 1e-5));
  // no potash price: no spread, never a half range
  assert.equal(NR.spread(st, NR.nutrientPrices({ prices: FIX.prices.filter((p) => p.key !== "potash") })), null);
  // the page names the sources and links them
  assert.match(html, /stovernutrients-1010\.html/);
  assert.match(html, /nutrient-removal-when-harvesting-corn-stover/);
  assert.match(html, /data-nr-spread/);
  assert.match(js, /The dollars above use <b>/, "the calculator says which source the dollars use");
});

test("copy: grain hints read right, no 'today's' on dated prices", () => {
  for (const c of NR.CROPS) assert.ok(!/\/fertilizer prices a program at/.test(c.defWhy), c.id + " hint");
  assert.equal(NR.crop("corn_grain").defWhy, "the yield the corn program on /fertilizer is priced at");
  // the site menu's "Today's briefing" link is not a price; check the page's own copy
  const own = html.replace(/<!-- static-nav:(header|footer)[\s\S]*?<!-- \/static-nav:\1 -->/g, "");
  assert.ok(!/today/i.test(own), "prices are dated, never 'today's'");
  assert.match(html, /posted through <span data-nr="asof">/);
  assert.match(html, /Phosphate is MAP \(DAP if no co-op posts MAP\)/);
});

test("corn stalk bales, worked by hand", () => {
  const pr = NR.nutrientPrices(FIX);
  const r = NR.cropLine({ crop: "corn_stover", yield: 3, acres: 80, baleLb: 1000, baleMoist: 15, sale: 35, saleUnit: "bale" }, pr);
  // a dry ton: 4.6 x 0.818980 = 3.767308, 32 x 0.40 = 12.80, together 16.567308
  const dryTon = 4.6 * PP + 32 * 0.4;
  assert.ok(near(r.perUnit.pk, dryTon));
  assert.ok(near(r.perUnit.pk, 16.567308, 0.00001));
  assert.ok(near(r.lbAc.p, 13.8) && near(r.lbAc.k, 96));
  assert.ok(near(r.perAc, 3 * dryTon));                   // 49.70 an acre
  assert.ok(near(r.field, 80 * 3 * dryTon));              // 3,976 for 80 acres
  assert.ok(near(r.perBaledTon, 0.85 * dryTon));          // 14.08 a ton at 15% moisture
  assert.ok(near(r.perBale, 0.85 * dryTon * 0.5));        // 1,000 lb bale = 0.425 dry ton: 7.04
  assert.ok(near(r.balesAc, 3 / 0.85 * 2));               // 7.06 bales an acre
  assert.ok(near(r.sale.nutrient, r.perBale) && near(r.sale.left, 35 - r.perBale));
});

test("corn silage and soybean grain, worked by hand", () => {
  const pr = NR.nutrientPrices(FIX);
  const s = NR.cropLine({ crop: "corn_silage", yield: 20, acres: 0 }, pr);
  assert.ok(near(s.lbAc.p, 72) && near(s.lbAc.k, 166));
  assert.ok(near(s.perAc, 20 * (3.6 * PP + 8.3 * 0.4)));
  assert.equal(s.perBale, null);
  assert.equal(s.field, null);
  const b = NR.cropLine({ crop: "soy_grain", yield: 55, acres: 100, sale: 10, saleUnit: "ton" }, pr);
  assert.ok(near(b.perUnit.pk, 0.8 * PP + 1.4 * 0.4));   // 1.2152 a bushel
  assert.ok(near(b.sale.nutrient, b.perUnit.pk), "a grain sale compares per bushel");
});

test("a missing price stays missing: no potash, no P and K total", () => {
  const pr = NR.nutrientPrices({ prices: FIX.prices.filter((p) => p.key !== "potash") });
  assert.equal(pr.k, null);
  const r = NR.cropLine({ crop: "alfalfa", yield: 4, acres: 40, baleLb: 1200, baleMoist: 15, sale: 60, saleUnit: "bale" }, pr);
  assert.equal(r.perUnit.pk, null);
  assert.equal(r.perAc, null);
  assert.equal(r.perBale, null);
  assert.equal(r.sale, null);
  assert.equal(NR.money(null), "no price");
});

test("no N price: phosphate from an N-bearing product is withheld, not charged the N", () => {
  const pr = NR.nutrientPrices({ prices: FIX.prices.filter((p) => !/^(urea|anhydrous|ams)$/.test(p.key)) });
  assert.equal(pr.n, null);
  assert.equal(pr.p, null);
});

test("the live price file gives a P and a K price with a source and date", () => {
  const data = JSON.parse(readFileSync(ROOT + "data/fertilizer-prices.json", "utf8"));
  const pr = NR.nutrientPrices(data);
  for (const x of ["n", "p", "k"]) {
    assert.ok(pr[x] && pr[x].usd > 0 && pr[x].usd < 5, x + " price");
    assert.match(pr[x].row.as_of, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(pr[x].row.label, x + " carries its co-op label");
    const row = data.prices.find((r) => r.key === pr[x].row.key);
    assert.equal(row.price, pr[x].row.price, "price comes straight from the shared file");
  }
  const dv = NR.derivation(pr);
  assert.match(dv.p, /lb of P2O5/);
});

test("page: head, byline, canonical, sources and honest empty states", () => {
  assert.match(html, /<title>[^<]*Nutrient Removal[^<]*\| AGSIST<\/title>/);
  assert.match(html, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/nutrient-removal">/);
  assert.match(html, /Sigurd Lindquist, CCA/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /A2809-web\.pdf/);
  assert.match(html, /<script src="\/components\/nutrient-removal\.js\?v=\d+" defer><\/script>/);
  assert.match(html, /no N or S removal per ton/, "says plainly why N and S are missing");
  assert.match(js, /Prices did not load\. The pounds below still hold/, "designed state when prices fail");
  for (const c of NR.CROPS) assert.ok(html.includes(`data-crop="${c.id}"`), c.id + " has a table row");
});

test("page: no em dashes, no typed dollar figures, no AI filler", () => {
  for (const [name, s] of [["html", html], ["js", js]]) {
    assert.ok(!/—|&mdash;|&#8212;/.test(s), name + " has an em dash");
    assert.ok(!/\b(delve|seamless|leverage|unlock|game-changer)\b/i.test(s), name + " filler word");
  }
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(!/\$\s?\d/.test(body), "every dollar figure is drawn from the price file, none typed");
  assert.ok(!/\$\s?\d/.test(js), "the script types no dollar figure");
});

test("page: FAQ JSON-LD matches the questions on the page", () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.flatMap((x) => x["@graph"] || [x]).find((x) => x["@type"] === "FAQPage");
  assert.ok(faq && faq.mainEntity.length >= 4);
  for (const q of faq.mainEntity) assert.ok(html.includes(`<summary>${q.name}</summary>`), q.name);
});

test("FAQ arithmetic matches A2809", () => {
  // 1,000 lb bale at 15% = 850 lb dry = 0.425 dry ton: 1.955 lb P2O5 ("about 2"), 13.6 lb K2O
  assert.ok(near(0.425 * 4.6, 1.955) && near(0.425 * 32, 13.6));
  assert.match(plain, /about 2 lb of P2O5 and 13\.6 lb of K2O/);
  // 20 ton silage: 72 and 166; 180 bu corn: 52 lb K2O
  assert.match(plain, /about 72 lb of P2O5 and 166 lb of K2O/);
  assert.ok(near(180 * 0.29, 52.2));
  // 3 dry ton stover: 13.8 ("about 14") and 96
  assert.match(plain, /about 14 lb of P2O5 and 96 lb of K2O/);
  // a ton at 15%: 3.91 ("about 3.9") and 27.2 ("27")
  assert.match(plain, /about 3\.9 lb of P2O5 and 27 lb of K2O/);
});
