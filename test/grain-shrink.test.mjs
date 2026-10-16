/* Grain shrink (components/grain-shrink.js, grain-shrink-ui.js) and the
 * /grain-shrink page.
 *
 * The shipped files run here. Every worked example is from a source read in
 * full on the references branch (NCH-61, Iowa State ICM 2019, NDSU 2009) or
 * is the arithmetic written out beside it, so a reader can redo it by hand.
 * Browser checks need Playwright and Chromium and skip without them.
 *
 *   node --test test/grain-shrink.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import vm from "node:vm";
import { bake, FAQ } from "../scripts/build_grain_shrink.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = {};
vm.runInNewContext(readFileSync(ROOT + "components/grain-shrink.js", "utf8"), ctx);
const S = ctx.AgShrink;
vm.runInNewContext(readFileSync(ROOT + "components/cb-rank.js", "utf8"), ctx);
const R = ctx.cbRank;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const page = readFileSync(ROOT + "grain-shrink.html", "utf8");
const ui = readFileSync(ROOT + "components/grain-shrink-ui.js", "utf8");
const math = readFileSync(ROOT + "components/grain-shrink.js", "utf8");
const bakeSrc = readFileSync(ROOT + "scripts/build_grain_shrink.mjs", "utf8");

/* ---------------- hand-worked examples ---------------- */

test("example 1, Iowa State ICM 2019: 20.5% corn, 4.8 cents a point, 1.4% a point from 15%", () => {
  // 56,000 lb / 56 = 1,000 wet bu. 5.5 points x 1.4 = 7.7% -> 923 bu.
  // Drying 0.048 x 5.5 x 1,000 = $264. Net 923 x 3.50 - 264 = $2,966.50 (ISU: "$2,967").
  const o = S.wet({ m: 20.5, base: 15, lbs: 56000, tw: 56, bid: 3.5, method: "factor", factor: 1.4, drying: { kind: "point", cents: 4.8 } });
  near(o.wetBu, 1000, 1e-9, "wet bu");
  near(o.shrinkPct, 7.7, 1e-9, "shrink");
  near(o.dryBu, 923, 1e-9, "dry bu");
  near(o.drying, 264, 1e-9, "drying");
  near(o.net, 2966.5, 1e-9, "net");
  assert.equal(Math.round(o.net), 2967);
});

test("example 2, NCH-61 buyer 2: 100,000 lb of 20% corn to 13%, water shrink plus 0.5%, $2.55", () => {
  // 7 points x 100/87 = 8.046% water + 0.5 = 8.546%. 100,000/56 = 1,785.71 wet bu.
  // 1,785.71 x 0.91454 = 1,633.1 dry bu (NCH-61 rounds the factor to 1.149 and gets 1,633.2).
  // 1,633.1 x 2.55 = $4,164.4 (NCH-61: $4,164.66 from the rounded bushels).
  const o = S.wet({ m: 20, base: 13, lbs: 100000, tw: 56, bid: 2.55, method: "water", handling: 0.5, drying: { kind: "none" } });
  near(o.waterPct, 8.046, 0.001, "water shrink");
  near(o.shrinkPct, 8.546, 0.001, "total");
  near(o.dryBu, 1633.2, 0.15, "dry bu");
  near(o.net, 4164.66, 0.4, "net sale");
});

test("example 3, overdry soybeans: 1,000 bu at 9% against 13%, $10", () => {
  // 1,000 x 91/87 = 1,045.98 bu at 13%, 45.98 more, $459.77 at $10.
  // Nebraska CropWatch: 75 bu/ac at 13% harvested at 9% sells 3.3 fewer bu/ac, $33/ac.
  // As weighed that field is 75 x 87/91 = 71.70 bu/ac; 71.70 x (91/87 - 1) = 3.297.
  const o = S.overdry({ m: 9, base: 13, bu: 1000, bid: 10, yieldBu: 75 * 87 / 91 });
  near(o.atBase, 1045.977, 0.001, "bu at base");
  near(o.extraBu, 45.977, 0.001, "given away");
  near(o.dollars, 459.77, 0.01, "dollars");
  near(o.extraPerAcre, 3.3, 0.005, "CropWatch 3.3 bu/ac");
  near(o.dollarsPerAcre, 33, 0.05, "CropWatch $33/ac");
  near(o.lossPct, 4.4, 0.01, "CropWatch 4.4%");
});

test("NCH-61: water shrink 11.24%, drying table 11.74%, 1.3 factor 12.35% (25% to 15.5%)", () => {
  near(S.waterShrink(25, 15.5), 11.24, 0.005, "water");
  near(S.totalShrink(25, 15.5, { method: "water", handling: 0.5 }), 11.74, 0.005, "method 1");
  near(S.totalShrink(25, 15.5, { method: "factor", factor: 1.3 }), 12.35, 1e-9, "method 2");
  near(S.handlingIn(25, 15.5, { method: "factor", factor: 1.3 }), 1.11, 0.005, "handling in 1.3");
});

test("NCH-61 Table 1 water shrink factors, and NDSU's 1.1834 and 5.92%", () => {
  for (const [b, f] of [[15.5, 1.183], [15, 1.176], [14, 1.163], [13, 1.149], [12, 1.136], [10, 1.111], [8, 1.087]]) near(S.waterFactor(b), f, 0.0006, `factor at ${b}`);
  near(S.waterFactor(15.5), 1.1834, 0.00005, "NDSU");
  near(S.waterShrink(20.5, 15.5), 5.92, 0.005, "NDSU 20.5 to 15.5");
  near(S.waterShrink(25, 15), 11.76, 0.005, "NDSU 25 to 15");
});

test("NCH-61 Table 2 handling loss in flat factors (15.5% base)", () => {
  const cells = [[28, 1.25, 0.83], [28, 1.3, 1.46], [28, 1.4, 2.71], [20, 1.2, 0.07], [32, 1.5, 5.22], [24, 1.35, 1.42]];
  for (const [m, f, h] of cells) near(S.handlingIn(m, 15.5, { method: "factor", factor: f }), h, 0.006, `${m}% at ${f}`);
});

test("NCH-61 Table 3: wet lb for 56 dry lb, and the 26% corn quote (15.23 dry bu)", () => {
  // 26% at 1.40 -> 65.65 lb; 1,000 lb = 17.86 wet bu -> 15.23 dry bu.
  const o = S.wet({ m: 26, base: 15.5, lbs: 1000, tw: 56, method: "factor", factor: 1.4 });
  near(56 / (1 - o.shrinkPct / 100), 65.65, 0.005, "Table 3 cell");
  near(o.dryBu, 15.23, 0.005, "dry bu");
  near(o.shrinkBu, 2.63, 0.005, "shrinkage loss");
});

test("Nebraska CropWatch soybean table: 1.14, 2.25, 3.3, 4.4, 5.43% at 12 to 8%", () => {
  for (const [m, p] of [[12, 1.14], [11, 2.25], [10, 3.3], [9, 4.4], [8, 5.43]]) near(S.overdry({ m, base: 13 }).lossPct, p, 0.04, `${m}%`);
});

test("drying charge: per point, by table band, and no answer past the table", () => {
  near(S.dryingPerBu(20, 15.5, { kind: "point", cents: 4 }), 0.18, 1e-9, "4.5 pts x 4c");
  const t = { kind: "table", rows: [{ upTo: 22, cents: 30 }, { upTo: 18, cents: 15 }, { upTo: 20, cents: 22 }] };
  assert.equal(S.dryingPerBu(17, 15.5, t), 0.15);
  assert.equal(S.dryingPerBu(18, 15.5, t), 0.15);
  assert.equal(S.dryingPerBu(18.1, 15.5, t), 0.22);
  assert.equal(S.dryingPerBu(23, 15.5, t), null, "past the last band: no number, never a guess");
  assert.equal(S.dryingPerBu(15, 15.5, t), 0, "at or under base: no charge");
  const o = S.wet({ m: 23, base: 15.5, lbs: 56000, tw: 56, bid: 4, method: "factor", factor: 1.4, drying: t });
  assert.equal(o.drying, null); assert.equal(o.net, null);
});

test("bad input gives no answer", () => {
  assert.equal(S.wet({ m: 20, base: 15.5, lbs: 0, tw: 56 }), null);
  assert.equal(S.wet({ m: NaN, base: 15.5, lbs: 1000, tw: 56 }), null);
  assert.equal(S.overdry({ m: 9, base: NaN }), null);
  const at = S.overdry({ m: 13, base: 13, bu: 1000 });
  assert.equal(at.extraPer1000, 0);
});

/* ---------------- dry it myself ---------------- */

test("dry it myself, Iowa State ICM 2019: 20.5% corn to 15%, 3 cents a point, 1% handling, $40 haul, $3.50", () => {
  // 56,000 lb x 0.795 = 44,520 lb dry matter; / 0.85 = 52,376 lb; less 560 lb (1% of wet) = 51,816 lb = 925.3 bu.
  // Drying 0.03 x 5.5 x 1,000 = $165. Haul 4 mi x 1c x 1,000 = $40. 925.29 x 3.50 - 205 = $3,033.53 (ISU: "$3,033", 925 bu).
  const f = S.farm({ m: 20.5, base: 15, lbs: 56000, tw: 56, bid: 3.5, handling: 1, mode: "allin", allin: 3, miles: 4, haul: 1 });
  near(f.dryMatterLb, 44520, 1e-6, "dry matter");
  near(f.atBaseLb, 52376.47, 0.01, "ISU 52,376 lb");
  near(f.handlingLb, 560, 1e-9, "ISU 560 lb");
  near(f.dryBu, 925.29, 0.01, "ISU 925 bu");
  near(f.drying, 165, 1e-9, "ISU $165");
  near(f.haul, 40, 1e-9, "ISU $40");
  assert.equal(Math.floor(f.net), 3033, "ISU $3,033");
  // and the elevator side of the same example nets $2,966.50: drying it yourself wins by about $67
  const o = S.wet({ m: 20.5, base: 15, lbs: 56000, tw: 56, bid: 3.5, method: "factor", factor: 1.4, drying: { kind: "point", cents: 4.8 } });
  near(f.net - o.net, 67.03, 0.01, "difference");
});

test("dry it myself, Iowa State ICM 2022: 20% corn, 4 cents a point, $6.50", () => {
  // 44,800 / 0.85 = 52,706 lb; less 560 = 52,146 lb = 931.2 bu (ISU: 931). 931.18 x 6.50 - 200 - 40 = $5,812.65
  // (ISU: $5,811 from 931 rounded bushels: 931 x 6.50 = 6,051.50 - 240).
  const f = S.farm({ m: 20, base: 15, lbs: 56000, tw: 56, bid: 6.5, handling: 1, mode: "allin", allin: 4, miles: 4, haul: 1 });
  near(f.atBaseLb, 52705.88, 0.01, "ISU 52,706 lb");
  near(f.sellLb, 52145.88, 0.01, "ISU 52,146 lb");
  assert.equal(Math.round(f.dryBu), 931);
  near(f.drying, 200, 1e-9, "ISU $200");
  near(Math.round(f.dryBu) * 6.5 - f.drying - f.haul, 5811.5, 1e-9, "ISU $5,811 on rounded bushels");
  // the elevator's side, as Iowa State works it: 1.4% x 5 = 7% -> 930 bu x 6.50 - $250 = $5,795
  const o = S.wet({ m: 20, base: 15, lbs: 56000, tw: 56, bid: 6.5, method: "factor", factor: 1.4, drying: { kind: "point", cents: 5 } });
  near(o.net, 5795, 1e-9, "ISU $5,795 sold wet");
});

test("dry it myself, LP and electricity: Iowa State gallons and Purdue GQ-3's two equations", () => {
  // ISU: 0.018 gal x bushels dried x points. 1,000 bu x 5 pts x 0.018 = 90 gal; at $1.50 = $135.
  let f = S.farm({ m: 20, base: 15, lbs: 56000, tw: 56, mode: "fuel", gal: 0.018, lp: 1.5 });
  near(f.gallons, 90, 1e-9, "90 gal"); near(f.fuel, 135, 1e-9, "$135"); assert.equal(f.powerCounted, false); assert.equal(f.drying, 135);
  // Purdue Eq. 1: 28% to 15%, 20,624 BTU/bu / 92,000 BTU/gal x $0.60 = 13.5 cents a bushel.
  // As gallons a bushel a point: 20,624 / 92,000 / 13 = 0.017244. Eq. 2: 42.5 hp x 0.746 x $0.07 / 300 bu/h = 0.74 cents a dry bushel.
  // Purdue: 13.5 + 0.7 = 14.2 cents.
  f = S.farm({ m: 28, base: 15, lbs: 56000, tw: 56, mode: "fuel", gal: 20624 / 92000 / 13, lp: 0.6, hp: 42.5, kwh: 0.07, buHr: 300 });
  near(f.fuel / f.wetBu, 0.1345, 0.0001, "Purdue 13.5 cents");
  near(f.power / f.dryBu, 0.0074, 0.00005, "Purdue 0.7 cents");
  assert.equal(f.powerCounted, true);
  // 22% to 15%: 12,589 / 92,000 = 8.2 cents; at 375 bu/h, 0.6 cents
  f = S.farm({ m: 22, base: 15, lbs: 56000, tw: 56, mode: "fuel", gal: 12589 / 92000 / 7, lp: 0.6, hp: 42.5, kwh: 0.07, buHr: 375 });
  near(f.fuel / f.wetBu, 0.082, 0.0005, "Purdue 8.2 cents"); near(f.power / f.dryBu, 0.006, 0.0005, "Purdue 0.6 cents");
  // the hint's 0.017 to 0.020 range is those two worked back to gallons
  assert.equal((20624 / 92000 / 13).toFixed(3), "0.017"); assert.equal((12589 / 92000 / 7).toFixed(3), "0.020");
});

test("dry it myself withholds a number it cannot work", () => {
  const base = { m: 20, base: 15, lbs: 56000, tw: 56, bid: 4 };
  let f = S.farm({ ...base, mode: "fuel", lp: 1.5 });
  assert.equal(f.drying, null, "no gallons, no drying cost"); assert.equal(f.net, null);
  f = S.farm({ ...base, mode: "fuel", gal: 0.018 });
  assert.equal(f.drying, null, "no LP price");
  f = S.farm({ ...base, mode: "allin" });
  assert.equal(f.net, null, "no all-in figure");
  f = S.farm({ ...base, mode: "fuel", gal: 0.018, lp: 1.5, hp: 40, kwh: 0.14 });
  assert.equal(f.powerCounted, false, "power needs all three boxes"); assert.equal(f.power, 0);
  assert.equal(S.farm({ ...base, m: 15 }), null, "at base: nothing to dry");
  assert.equal(S.farm({ ...base, lbs: 0 }), null);
  // the default handling loss is Iowa State's 1%
  near(S.farm({ ...base, mode: "allin", allin: 3 }).handlingPct, 1, 0, "1%");
});

test("page: the dry-it-myself box cites its sources and leaves the fuel boxes blank", () => {
  for (const id of ["gs-lp", "gs-gal", "gs-kwh", "gs-hp", "gs-buhr", "gs-allin", "gs-miles", "gs-haul"]) {
    const m = page.match(new RegExp(`<input id="${id}"[^>]*>`));
    assert.ok(m, id); assert.doesNotMatch(m[0], /value=|placeholder=/, `${id} starts blank: the hint is a range, not the farmer's number`);
  }
  assert.match(page, /<input id="gs-fhand"[^>]*value="1"/);
  assert.match(page, /0\.018 gallon of LP a bushel a point on average, anywhere from 0\.010 to 0\.025/);
  assert.match(page, /hp x 0\.746 x price a kWh \/ dry bushels an hour/);
  assert.match(page, /It leaves out labor, dryer payments and repairs\./);
  assert.match(page, /options-fall-grain-drying-and-marketing/);
  assert.match(page, /extmedia\/gq\/gq-3\.html/);
  assert.match(ui, /S\.farm\(/);
});

/* ---------------- the bid ---------------- */

const prices = { quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 478.25, close_date: "2026-10-15" }, "kcwheat-dec26": { ticker: "KEZ26.CBT", close: 712.25, close_date: "2026-10-15" } } };
const basis = { generated: "2026-10-16T02:01:49Z", states: {
  IA: { name: "Iowa", crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 216, median: -0.4 }, soybeans: { contract: "ZSX26", label: "Nov '26", n: 3 } } },
  KS: { name: "Kansas", crops: { wheat_hrw: { contract: "KEZ26", label: "Dec '26", n: 185, median: -0.7 }, wheat_srw: { contract: "ZWZ26", n: 10, median: -1.07 }, wheat_hrs: { contract: "MWZ26", n: 1 } } }
} };

test("state default bid: futures settle plus the state median basis, labeled", () => {
  const d = S.defaultBid(prices, basis, "IA", "corn");
  near(d.bid, 4.3825, 1e-9, "4.7825 - 0.40");
  assert.equal(d.contract, "ZCZ26"); assert.equal(d.n, 216); assert.equal(d.stateName, "Iowa");
  const w = S.defaultBid(prices, basis, "KS", "wheat");
  assert.equal(w.cls, "wheat_hrw", "the class most of the state's elevators quote");
  near(w.bid, 6.4225, 1e-9, "7.1225 - 0.70");
});

test("futures label: 'settle' only for a recorded settle; a mid-session quote is delayed, with its read time", () => {
  // data/prices.json read at 15:01 UTC Oct 16, 2026: close 474.25 dated Oct 16, settles stop at Oct 15
  const mid = { fetched: "2026-10-16T15:01:00Z", quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-16", settles: { "2026-10-15": 478.25 } } } };
  const q = S.quoteFor(mid, "ZCZ26");
  assert.equal(q.settled, false);
  assert.equal(S.futuresWhen(q), "delayed, Oct 16 10:01 am CT");
  const d = S.defaultBid(mid, basis, "IA", "corn");
  near(d.bid, 4.3425, 1e-9, "4.7425 - 0.40");
  assert.equal(d.settled, false); assert.equal(d.futuresRead, "2026-10-16T15:01:00Z");
  // the evening file: the Oct 16 settle recorded at the same price
  const eve = { fetched: "2026-10-16T23:00:00Z", quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 473.25, close_date: "2026-10-16", settles: { "2026-10-15": 478.25, "2026-10-16": 473.25 } } } };
  assert.equal(S.futuresWhen(S.quoteFor(eve, "ZCZ26")), "settle Oct 16");
  // no settles and no read time: "delayed", no time made up
  assert.equal(S.futuresWhen(S.quoteFor({ quotes: mid.quotes }, "ZCZ26")), "delayed");
  assert.doesNotMatch(ui, /'\(settle ' \+/, "the old unconditional settle label is gone");
  assert.match(ui, /S\.futuresWhen\(/);
});

test("ZIP bid re-marks on the /cash-bids rule (cb-rank.js), reused not copied", () => {
  R.setFutures({ quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-16" } } });
  const now = Date.parse("2026-10-16T15:05:00Z");
  // River Country Co-op, Bloomer: corn $4.14, basis -65c, read Oct 15 8:40 pm CT, board states ZCZ26
  const n = { crop: "corn", commodity: "Corn", cashPrice: 4.14, basis: -0.65, basisCents: -65, delivery: "HAR 26",
    pricedAt: "2026-10-16T01:40:19.715Z", checkedAt: "2026-10-16T01:40:19.715Z" };
  // re-marked: 4.7425 - 0.65 = 4.0925 -> $4.09, posted $4.14 beside it
  let z = S.zipBid(n, "ZCZ26", R, now);
  assert.equal(z.price, 4.09); assert.equal(z.posted, 4.14); assert.equal(z.text, "≈$4.09");
  assert.match(z.note, /on today’s futures · posted Thu \$4\.14/);
  // the same row through cb-rank directly, the way /cash-bids asks it: the same number
  const rk = R.assess({ via: "direct", asOf: n.pricedAt, category: "corn", symbol: "ZCZ26" }, { cash: 4.14, basisC: -65, now });
  assert.equal(rk.price, z.price);
  // CDR Farms, Bloomer: same price, but its board states no futures month -> posted stands, flagged
  z = S.zipBid(n, "", R, now);
  assert.equal(z.price, 4.14); assert.equal(z.old, true); assert.equal(z.remark, null);
  assert.match(z.note, /not updated for today’s futures/);
  // posted today: as posted
  z = S.zipBid({ ...n, pricedAt: "2026-10-16T14:00:00Z", checkedAt: "2026-10-16T14:00:00Z" }, "ZCZ26", R, now);
  assert.equal(z.price, 4.14); assert.equal(z.old, false); assert.equal(z.remark, null);
  // a garbled basis is never carried into a price (more than a dollar off the posted)
  z = S.zipBid({ ...n, basisCents: -265 }, "ZCZ26", R, now);
  assert.equal(z.price, 4.14); assert.equal(z.old, true);
  // no ranking module: the posted price, nothing invented
  z = S.zipBid(n, "ZCZ26", null, now);
  assert.equal(z.price, 4.14); assert.equal(z.remark, null);
  // the page loads the shared module and does not carry its own copy of the rule
  assert.match(page, /<script src="\/components\/cb-rank\.js\?v=\d+" defer><\/script>[\s\S]*grain-shrink-ui\.js/);
  assert.match(math, /rank\.assess\(/);
  assert.doesNotMatch(math + ui, /function contractKey|function setFutures/);
  assert.match(ui, /NET\.sourceFile\(/);
});

test("state default bid is withheld, never guessed", () => {
  assert.equal(S.defaultBid(prices, basis, "IA", "soybeans"), null, "no median for Iowa beans in the fixture");
  assert.equal(S.defaultBid(prices, basis, "IA", "sorghum"), null, "no sorghum basis");
  assert.equal(S.defaultBid({ quotes: {} }, basis, "IA", "corn"), null, "no futures");
  assert.equal(S.defaultBid(prices, basis, "ZZ", "corn"), null);
  assert.equal(S.defaultBid(null, null, "IA", "corn"), null);
});

test("ZIP bid: the nearest elevator posting that grain, from the network snapshot", () => {
  const snap = { bids: [
    { crop: "corn", cashPrice: 4.1, distance: 30, facility: "B" },
    { crop: "soybeans", cashPrice: 10.2, distance: 5, facility: "A" },
    { crop: "corn", cashPrice: 4.14, distance: 17, facility: "C" },
    { crop: "corn", cashPrice: null, distance: 2, facility: "D" }
  ] };
  assert.equal(S.nearestBid(snap, "corn").facility, "C");
  assert.equal(S.nearestBid(snap, "sorghum"), null);
  assert.equal(S.nearestBid(null, "corn"), null);
  assert.match(ui, /NET\.snapshotForZip\(/, "uses the shared network reader, not a copy");
  assert.match(page, /<script src="\/components\/bids-network\.js\?v=\d+" defer><\/script>/);
});

/* ---------------- the page ---------------- */

test("page: head, canonical, byline, JSON-LD, baked tables match the math", () => {
  assert.match(page, /<title>Grain shrink and moisture discount calculator \| AGSIST<\/title>/);
  assert.match(page, /<link rel="canonical"\s+href="https:\/\/agsist\.com\/grain-shrink">/);
  assert.match(page, /Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  assert.equal(bake(page), page, "run node scripts/build_grain_shrink.mjs");
  const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const faq = ld["@graph"].find((x) => x["@type"] === "FAQPage").mainEntity;
  assert.equal(faq.length, FAQ.length);
  assert.ok(faq.length >= 5);
  assert.match(page, /<tr><th scope="row">9%<\/th><td>4\.4%<\/td><td>46\.0<\/td><\/tr>/, "9% soybean row");
  assert.match(page, /<tr><th scope="row">15\.5%<\/th><td>1\.183%<\/td>/, "corn water factor row");
  assert.match(page, /href="\/grain-bin-calculator"/);
  assert.match(page, /NCH-61/);
  assert.match(page, /cropwatch\.unl\.edu\/harvest-soybeans-13-moisture/);
});

test("copy: no em or en dashes, nothing AI-sounding, no store names", () => {
  for (const [name, s] of [["page", page], ["ui", ui], ["math", math], ["bake", bakeSrc]]) {
    assert.doesNotMatch(s, /[–—]|&mdash;|&ndash;/, name + " has a long dash");
    assert.doesNotMatch(s, /\b(delve|leverage|seamless|unlock|empower|game-changer)\b/i, name);
    assert.doesNotMatch(s, /\b(Amazon|Walmart|Tractor Supply|Fleet Farm|Etsy)\b/, name);
  }
});

test("honest empty state: no bid until one comes from a source", () => {
  assert.match(page, /<input id="gs-bid" type="number"[^>]*placeholder="4\.00"/);
  assert.doesNotMatch(page, /<input id="gs-bid"[^>]*value=/, "no baked bid");
  assert.match(page, /Type your bid, or let the page fill one in\./);
  assert.match(ui, /State estimate, not a posted bid/);
  assert.match(ui, /Type your bid to see dollars\./);
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
async function open(browser, port, fx = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route("**/*", async (r) => {
    const u = r.request().url(), h = { "access-control-allow-origin": "*" };
    if (u.includes("/bids/data/zips/")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify({ 54728: [45.31, -91.65] }) });
    if (u.includes("/bids/data/merged-index.json")) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(fx.index || INDEX) });
    for (const [k, v] of Object.entries(fx.files || {})) if (u.includes(k)) return r.fulfill({ headers: h, contentType: "application/json", body: JSON.stringify(v) });
    if (u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    return r.abort();
  });
  await pg.goto(`http://127.0.0.1:${port}/grain-shrink`);
  return { pg, ctx, errors };
}

test("browser: wet corn with a ZIP bid and a drying charge; overdry beans per acre", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { pg, errors } = await open(browser, srv.address().port);
    await pg.waitForSelector("#gs-verdict");
    assert.match(await pg.textContent("#gs-verdict"), /1,000 wet bushels shrink to 937 dry bushels/, "no bid: bushels only");
    await pg.fill("#gs-zip", "54728");
    await pg.click("#gs-zipgo");
    await pg.waitForFunction(() => document.getElementById("gs-bid").value === "4.14");
    assert.match(await pg.textContent("#gs-bidsrc"), /Nearest posted corn bid: Test Coop, Bloomer WI.*Oct 2026 delivery/);
    await pg.check('input[name="gs-dry"][value="point"]');
    await pg.fill("#gs-cpp", "4.5");
    // 937 x 4.14 = 3,879.18 less 4.5 pts x 4.5c x 1,000 = 202.50 -> $3,676.68
    await pg.waitForFunction(() => /\$3,677 for the load/.test(document.getElementById("gs-verdict").textContent));
    await pg.click('[data-ex="dry"]');
    await pg.fill("#gs-bid", "10.50");
    await pg.fill("#gs-yield", "60");
    // 60,000 lb / 60 = 1,000 bu at 10%: x 90/87 = 1,034.48, 34.48 more, $362.07
    await pg.waitForFunction(() => /gave away 34\.5 bushels on this load: \$362 at \$10\.50/.test(document.getElementById("gs-verdict").textContent));
    assert.match(await pg.textContent("#gs-kv"), /2\.07 bu.*\$21\.72/s, "60 bu/ac x 3/87 = 2.069 bu, $21.72");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});

test("browser: delayed futures label, a day-old ZIP bid re-marked, and the dry-it-myself table", { skip }, async () => {
  const srv = await serve(), browser = await chromium.launch({ executablePath: CHROME });
  const now = Date.now(), day = 864e5;
  const ymd = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const prices = { fetched: new Date(now - 10 * 60e3).toISOString(), quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474.25, close_date: ymd(now), settles: { [ymd(now - day)]: 478.25 } } } };
  const basisJ = { generated: new Date(now).toISOString(), states: { IA: { name: "Iowa", crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 219, median: -0.4 } } } } };
  const old = new Date(now - 30 * 3600e3).toISOString();
  const index = { generated: old, places: [
    { place: "rc", operator: "River Country Co-op", city: "Bloomer", state: "WI", lat: 45.1, lon: -91.49, currency: "USD", zip: "54724", source: "rivercountrycoop-bloomer",
      pricedAt: old, checkedAt: old, now: { corn: { cash: 4.14, basis: -0.65, basisCents: -65, period: "newcrop-2026", delivery: "HAR 26", commodity: "Corn" } } }
  ] };
  const board = { bids: [{ commodity: "Corn", delivery: "HAR 26", futuresMonth: "ZCZ26", cash: 4.14, basisCents: -65 }] };
  try {
    const { pg, errors } = await open(browser, srv.address().port, { index, files: {
      "/data/prices.json": prices, "/data/basis-states.json": basisJ, "/bids/data/rivercountrycoop-bloomer.json": board } });
    await pg.waitForSelector("#gs-verdict");
    await pg.waitForFunction(() => document.querySelector('#gs-state option[value="IA"]'));
    await pg.selectOption("#gs-state", "IA");
    await pg.waitForFunction(() => document.getElementById("gs-bid").value === "4.34");
    const src = await pg.textContent("#gs-bidsrc");
    assert.match(src, /Dec '26 futures \$4\.74 \(delayed, \w{3} \d{1,2} \d{1,2}:\d{2} [ap]m CT\) less the Iowa median basis/);
    assert.doesNotMatch(src, /settle/);
    // ZIP: the board is a day old and states ZCZ26 -> 4.7425 - 0.65 = $4.09, posted $4.14 beside it
    await pg.fill("#gs-zip", "54728");
    await pg.click("#gs-zipgo");
    await pg.waitForFunction(() => document.getElementById("gs-bid").value === "4.09");
    const zs = await pg.textContent("#gs-bidsrc");
    assert.match(zs, /Nearest posted corn bid: River Country Co-op, Bloomer WI/);
    assert.match(zs, /Read [A-Z][a-z]{2} \d{1,2}, /, "pricedAt equals checkedAt: a read time, not a posted one");
    assert.match(zs, /Re-marked on today’s futures: ≈\$4\.09 \(board posted \w+ \$4\.14\), the same rule the cash bids page uses\./);
    // dry it myself: 20% corn, 56,000 lb, 1.4%/pt elevator; farm at 4c all in, 1% handling
    await pg.check('input[name="gs-fmode"][value="allin"]');
    await pg.fill("#gs-allin", "4");
    // elevator: 937 x 4.09 = 3,832.33 (no drying charge counted). farm: 44,800/0.845 = 53,017.75 - 560 = 52,457.75 lb = 936.75 bu
    //   x 4.09 = 3,831.30 - 0.04 x 4.5 x 1,000 = 180 -> 3,651.30
    await pg.waitForFunction(() => /\$3,651/.test(document.getElementById("gs-farm").textContent));
    const t = await pg.textContent("#gs-farm");
    assert.match(t, /Net for the load\$3,832\$3,651/);
    assert.match(t, /Selling wet nets \$181 more on this load, 18¢ a wet bushel\./);
    assert.match(t, /Your elevator's drying charge is not counted yet/);
    // fuel mode with no gallons: withheld, not guessed
    await pg.check('input[name="gs-fmode"][value="fuel"]');
    await pg.fill("#gs-lp", "1.50");
    await pg.waitForFunction(() => /Type your LP price and gallons/.test(document.getElementById("gs-farm").textContent));
    assert.match(await pg.textContent("#gs-farm"), /Dryingnot countedfill in/);
    assert.equal(await pg.isVisible("p.gs-allin"), false, "the all-in hint shows only in all-in mode");
    assert.equal(await pg.isVisible("#gs-gal"), true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
