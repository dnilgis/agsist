/* components/bid-filter.js: what may be "the highest checked bid".
 *
 * 2026-10-23: the corn futures page showed Baring Elevator, MO "Organic Yellow
 * Corn" $11.50 (no basis) as the highest checked bid in the sample for 13 of 50
 * grid ZIPs, labelled "Columbia, MO"; soybeans showed Riceville, IA at basis
 * +$1.40 against an Iowa middle near -$0.40 for 16. The rows below are the real
 * ones from data/bids.json that day.
 *   node --test test/bid-filter.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const BF = createRequire(import.meta.url)(join(ROOT, "components/bid-filter.js"));
const FUT = read("components/futures.js");

const BARING = { facility: "Baring Elevator", branch: "", city: "Baring Elevator", town: "Baring", state: "MO", zip: "63531",
  commodity: "Organic Yellow Corn", symbol: "", cashPrice: 11.5, basis: null, category: "corn", sourceZip: "",
  verified: true, source: "network", lat: 40.22101, lon: -92.21062, deliveryStart: "2026-10-01", deliveryEnd: "2026-10-31" };
const RICE = { facility: "Nutrition Service Co. LLC", branch: "", city: "Riceville", town: "", state: "IA", zip: "50466",
  commodity: "SOYBEANS", symbol: "ZSX26", cashPrice: 13.95, basis: 1.4, category: "soybeans", sourceZip: "55901",
  verified: true, source: "network", lat: 43.3719, lon: -92.5554, deliveryStart: "2026-10-01", deliveryEnd: "2026-10-31" };
const DUMAS = { facility: "Dumas Co-op Elevators", city: "Dumas", state: "TX", zip: "79029", commodity: "Corn", symbol: "ZCZ26",
  cashPrice: 5.15, basis: -0.4, category: "corn", sourceZip: "", verified: true, source: "network",
  deliveryStart: "2026-10-01", deliveryEnd: "2026-10-31" };
const ADM = { facility: "ADM", city: "Mankato", state: "MN", zip: "56001", commodity: "Soybeans", symbol: "ZSX26",
  cashPrice: 12.35, basis: -0.3, category: "soybeans", sourceZip: "56001", verified: true, source: "network",
  deliveryStart: "2026-10-01", deliveryEnd: "2026-10-31" };

/* futures.js, lifted: the picker and the label helper, with the filter loaded. */
function picker() {
  const a = FUT.indexOf("function normalizeCommodity"), z = FUT.indexOf("// Pull user location");
  const b = FUT.indexOf("function bidCash"), e = FUT.indexOf("/* The network's own count");
  const ctx = { window: { AG: { bidFilter: BF } }, Date };
  vm.createContext(ctx);
  vm.runInContext(FUT.slice(a, z) + FUT.slice(b, e) + ";this.pick=findBestBidForCrop;this.label=bidLabel;", ctx);
  return ctx;
}
const P = picker();
const GRID = (zip) => ({ grid: { zip }, distance: 0, exact: true });

test("the filter: special grades, non-bushel quotes and out-of-band prices cannot set a best bid", () => {
  assert.equal(BF.canSetBest(BARING), false);
  assert.equal(BF.canSetBest(DUMAS), true);
  assert.equal(BF.canSetBest(RICE), true, "Riceville is a plain soybean bid; its basis is the issue, not its grade");
  for (const c of ["NON-GMO SOYBEANS", "Organic Corn", "White Corn", "Feed Wheat", "Durum", "Spring Wheat", "Wheat (Hard Red Spring)", "Wheat - HRS", "Wheat DNS", "Soft White Wheat"])
    assert.equal(BF.isSpecialGrade({ commodity: c }), true, c);
  for (const c of ["Corn", "Yellow Corn", "#2 Corn", "Soybeans", "Wheat SRW", "Wheat (Hard Red Winter)", "KC Wheat"])
    assert.equal(BF.isSpecialGrade({ commodity: c }), false, c);
  assert.equal(BF.canSetBest({ commodity: "Soybean Meal", category: "soybeans", cashPrice: 12 }), false);
  assert.equal(BF.canSetBest({ commodity: "SOYBEANS", category: "soybeans", cashPrice: 120.083 }), false, "FJ Krob, a per-ton price");
  assert.equal(BF.canSetBest({ commodity: "Corn", category: "corn", cashPrice: 61 }), false);
  assert.equal(BF.canSetBest({ commodity: "Corn cwt", category: "corn", cashPrice: 9 }), false);
});

test("futures.js: organic corn at $11.50 is not the highest checked bid, locally or nationally", () => {
  const m = P.pick([BARING, DUMAS], GRID("11111"), "corn");
  assert.equal(m.bid, DUMAS);
  assert.equal(m.distance, null, "still labelled not near you");
  const local = P.pick([{ ...BARING, sourceZip: "65201" }, { ...DUMAS, sourceZip: "65201", cashPrice: 4.1 }], GRID("65201"), "corn");
  assert.equal(local.bid.cashPrice, 4.1, "the exact-ZIP branch filters too");
  assert.equal(P.pick([BARING], GRID("11111"), "corn"), null, "nothing plain: no number, not the organic one");
});

test("futures.js: a basis outlier flagged at fetch time is a local bid only, never the national pick", () => {
  const odd = { ...RICE, basisOdd: true };
  assert.equal(P.pick([odd, ADM], GRID("11111"), "beans").bid, ADM);
  const local = P.pick([odd, ADM], GRID("55901"), "beans");
  assert.equal(local.bid, odd);
  assert.notEqual(local.distance, null);
  assert.equal(P.pick([odd], GRID("11111"), "beans"), null);
  assert.equal(P.pick([RICE, ADM], GRID("11111"), "beans").bid, RICE, "without the flag the old pick stands");
});

test("futures.js: no filter script on the page means no pick, not an unfiltered one", () => {
  const a = FUT.indexOf("function normalizeCommodity"), z = FUT.indexOf("// Pull user location");
  const b = FUT.indexOf("function bidCash"), e = FUT.indexOf("/* The network's own count");
  const ctx = { window: {}, Date };
  vm.createContext(ctx);
  vm.runInContext(FUT.slice(a, z) + FUT.slice(b, e) + ";this.pick=findBestBidForCrop;", ctx);
  assert.equal(ctx.pick([BARING, DUMAS], GRID("11111"), "corn"), null);
});

test("futures.js: a bid is printed under its own town, not the nearest sample ZIP's name", () => {
  const COLUMBIA = { zip: "65201", label: "Columbia, MO", lat: 38.95, lng: -92.33 };
  assert.equal(P.label(BARING, null, COLUMBIA), "Baring, MO", "town first: city holds the elevator's name");
  assert.equal(P.label(DUMAS, null, COLUMBIA), "Dumas, TX");
  assert.equal(P.label({ ...DUMAS, zip: "65201" }, COLUMBIA, COLUMBIA), "Columbia, MO", "the grid label only when the bid sits AT that ZIP");
  assert.equal(P.label({ facility: "Some Co-op", state: "MO" }, null, COLUMBIA), "Some Co-op");
});

test("the three futures pages load the filter before futures.js", () => {
  for (const pg of ["corn", "soybean", "wheat"]) {
    const h = read(`${pg}-futures-prices.html`);
    const f = h.indexOf("components/bid-filter.js"), u = h.indexOf("components/futures.js");
    assert.ok(f > 0 && u > f, pg + ": bid-filter.js before futures.js");
  }
});

test("with the committed bids.json, no grid ZIP's pick is a special grade or out of band, any crop", () => {
  const d = JSON.parse(read("data/bids.json"));
  for (const crop of ["corn", "beans", "wheat"])
    for (const g of d.zip_grid) {
      const m = P.pick(d.bids, { grid: g, distance: 0, exact: true }, crop);
      if (m && m.bid) assert.equal(BF.canSetBest(m.bid), true, `${crop} ${g.zip}: ${m.bid.facility} ${m.bid.commodity} ${m.bid.cashPrice}`);
    }
});

/* ONE WORD LIST. The copies that remain cannot be removed without breaking the
   tests that lift those functions by name, so each is compared to bid-filter.js. */
test("every copy of the special-grade word list is the one in bid-filter.js", () => {
  const js = (f, re) => (read(f).match(re) || [])[1];
  const want = BF.SPECIAL_GRADE.source;
  assert.equal(js("components/cash-bids.js", /var SPECIAL_GRADE=\/(.*?)\/i;/), want);
  assert.equal(js("components/bids-homepage.js", /var SPECIAL_GRADE = \/(.*?)\/i;/), want);
  assert.equal(js("components/daily-local.js", /var SPECIAL = \/(.*?)\/i;/), want);
  assert.equal(js("scripts/local_bid.py", /SPECIAL_GRADE = re\.compile\(r"(.*?)", re\.I\)/), want);
  assert.equal(js("scripts/daily_edge.py", /SPECIAL_GRADE = re\.compile\(r"(.*?)", re\.I\)/), want);
});

test("the price bands agree wherever they are declared", () => {
  const pyBand = (f) => { const m = read(f).match(/PPU_BAND = \{(.*?)\}/s)[1]; const o = {};
    for (const x of m.matchAll(/"(\w+)": \(([\d.]+), ([\d.]+)\)/g)) o[x[1]] = [+x[2], +x[3]]; return o; };
  const jsBand = (f, re) => { const m = read(f).match(re)[1]; const o = {};
    for (const x of m.matchAll(/(\w+):\s*\[([\d.]+),\s*([\d.]+)\]/g)) o[x[1]] = [+x[2], +x[3]]; return o; };
  const want = BF.PPU_BAND;
  assert.deepEqual(jsBand("components/bids-homepage.js", /var PPU_BAND = \{(.*?)\};/s), want);
  assert.deepEqual(pyBand("scripts/local_bid.py"), want);
  assert.deepEqual(jsBand("components/cash-bids.js", /var PPU_BAND=\{(.*?)\};/s), { corn: want.corn, soybeans: want.soybeans, wheat: want.wheat });
  assert.deepEqual(jsBand("components/daily-local.js", /var BAND = \{(.*?)\};/s), { corn: want.corn, soybeans: want.soybeans });
  const de = pyBand("scripts/daily_edge.py"); assert.deepEqual(de, { corn: [2, 12], soybeans: [6, 32] });
});

test("nobody else declares a special-grade word list", () => {
  const ALLOWED = new Set(["components/bid-filter.js", "components/cash-bids.js", "components/bids-homepage.js", "components/daily-local.js",
    "scripts/local_bid.py", "scripts/daily_edge.py", "scripts/build_state_basis_pages.py"]);
  const hits = [];
  for (const dir of ["components", "scripts"])
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.(js|py|mjs)$/.test(f)) continue;
      if (/non\[- \]\?gmo|nongmo/i.test(read(`${dir}/${f}`)) && !ALLOWED.has(`${dir}/${f}`)) hits.push(`${dir}/${f}`);
    }
  assert.deepEqual(hits, [], "a new copy of the word list: use AG.bidFilter / local_bid.can_set_best");
});

test("Fast Facts (place.js bestBids): organic corn near Baring is not the best bid within 50 miles", () => {
  const P2 = createRequire(import.meta.url)(join(ROOT, "components/place.js"));
  const near = { ...DUMAS, facility: "Kirksville Co-op", city: "Kirksville", state: "MO", cashPrice: 4.2, lat: 40.19, lon: -92.58 };
  const b = P2.bestBids({ bids: [BARING, near] }, 40.22, -92.21, 50).corn;
  assert.equal(b.best.price, 4.2);
  assert.equal(b.best.facility, "Kirksville Co-op");
  assert.ok(read("fast-facts.html").indexOf("components/bid-filter.js") < read("fast-facts.html").indexOf("components/place.js"));
});
