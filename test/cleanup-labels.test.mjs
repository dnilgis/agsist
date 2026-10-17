/* Small label and rounding fixes from the Oct 17 numbers audit (N13) and the
 * stale-data pass. Each runs the shipped code, not a copy.
 *
 *   node --test test/cleanup-labels.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const require = createRequire(import.meta.url);
const PS = require(ROOT + "components/price-local.js");

function fn(src, name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, name + " not found");
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1); }
  throw new Error("unbalanced " + name);
}

test("markets: silver's 56.995 close prints $56.99, as the seed and the homepage print it", () => {
  const ctx = { TICK: {}, AG: {} };
  vm.createContext(ctx);
  vm.runInContext(fn(read("markets.html"), "num") + ";this.num=num;", ctx);
  assert.equal(ctx.num(56.995, "silver"), "56.99");
  assert.equal(ctx.num(4181.1001, "gold"), "4,181.10");
});

test("futures: one set of range words; 74% is the upper half, never mid-range", () => {
  const src = read("components/futures.js");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fn(src, "bandOf") + ";this.bandOf=bandOf;", ctx);
  assert.equal(ctx.bandOf(74), "upper half");
  assert.equal(ctx.bandOf(24), "lower quartile");
  assert.equal(ctx.bandOf(75), "upper quartile");
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /mid-range|Mid-range|upper third/);
  assert.match(src, /setTxt\('rng-lbl','52-Week Range: Soybeans '\+\(nearby\?lbl:/);
});

test("basis map labels use the table's formatter (+12½¢, not +13¢)", () => {
  const src = read("components/basis-map.js");
  assert.match(src, /AG\.px\.basis\(c\)/);
  assert.match(src, /Math\.round\(c\.median \* 10000\) \/ 100/);
});

test("Fast Facts: next Dec from August (Central time), and never an expired one", () => {
  const src = read("components/fast-facts.js");
  const ctx = { window: { AgPxStamp: PS }, Intl, Date };
  ctx.AgPxStamp = PS;
  vm.createContext(ctx);
  vm.runInContext(fn(src, "ctYM") + fn(src, "newCropKey") + ";this.k=newCropKey;", ctx);
  const q = { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474 }, "corn-dec27": { ticker: "ZCZ27.CBT", close: 506 }, "corn-dec28": { ticker: "ZCZ28.CBT", close: 510 } };
  assert.equal(ctx.k(new Date("2026-07-15T17:00:00Z"), q).key, "corn-dec26");
  assert.equal(ctx.k(new Date("2026-10-17T17:00:00Z"), q).label, "Dec '27");
  // Aug 1, 00:30 UTC is still July 31 in Central time
  assert.equal(ctx.k(new Date("2026-08-01T00:30:00Z"), q).key, "corn-dec26");
  // file missing the wanted Dec: the next live one, not a dead one
  assert.equal(ctx.k(new Date("2026-10-17T17:00:00Z"), { "corn-dec26": q["corn-dec26"], "corn-dec28": q["corn-dec28"] }).key, "corn-dec28");
});

test("home price alert rolls an expired month and stamps the quote's own settle", () => {
  const src = read("components/home.js");
  assert.match(src, /PS\.roll\)\?PS\.roll\(pd\.quotes\)/);
  assert.match(src, /PS\.stamp\(x,pd\.fetched\)/);
  const q = PS.roll({ "corn-dec": { ticker: "ZCZ26.CBT", close: 474, contract: "Dec '26" }, "corn-dec27": { ticker: "ZCZ27.CBT", close: 506 } }, new Date("2026-12-16T18:00:00Z"));
  assert.equal(q["corn-dec"].contract, "Dec '27");
  assert.equal(PS.stamp({ close_kind: "settle", settle_date: "2026-10-16" }, "2026-10-17T06:46:21Z", new Date("2026-10-17T12:00:00Z")), "Oct 16 settle");
});

test("crop progress is stamped with the Central-time date", () => {
  const src = read("scripts/fetch_crop_progress.py");
  assert.match(src, /ZoneInfo\("America\/Chicago"\)/);
  assert.doesNotMatch(src, /"updated":\s+datetime\.now\(\)\.strftime/);
});

test("urea: the cheapest N per lb is named from the posted prices, not asserted", () => {
  const html = read("urea.html");
  assert.doesNotMatch(html, /Highest N analysis = lowest cost per lb N/);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(fn(html, "cheapestN") + ";this.f=cheapestN;", ctx);
  // hand-worked: anhydrous $832.10 / (2,000 x 82%) = $0.507; urea $615.95 / 920 = $0.670; UAN28 $415.33 / 560 = $0.742
  const b = ctx.f({ prices: [
    { name: "Urea", symbol: "46-0-0", price: 615.95, unit: "$/ton", as_of: "2026-10-06" },
    { name: "Anhydrous ammonia", symbol: "82-0-0", price: 832.1, unit: "$/ton", as_of: "2026-10-06" },
    { name: "UAN 28%", symbol: "28-0-0", price: 415.33, unit: "$/ton", as_of: "2026-10-06" },
    { name: "AMS", symbol: "21-0-0-24S", price: 300, unit: "$/ton", as_of: "2026-10-06" }] });
  assert.equal(b.name, "Anhydrous ammonia");
  assert.equal(b.per.toFixed(2), "0.51");
  assert.equal(ctx.f({ prices: [] }), null);
  assert.ok(ctx.f(JSON.parse(read("data/fertilizer-prices.json"))), "the live price file names one");
});
