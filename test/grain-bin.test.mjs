/* Grain bin math (components/grain-bin.js) and the /grain-bin-calculator page.
 *
 * The shipped file runs in a bare context (no document), so a green run checks
 * the copy the browser runs. Three real bins are worked by hand below with the
 * arithmetic written out, then checked against the module and against the
 * table baked into the page.
 *
 *   node --test test/grain-bin.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const ctx = { window: {} };
vm.runInNewContext(read("components/grain-bin.js"), ctx);
const G = ctx.window.AgGrainBin;
const near = (a, b, msg, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const PAGE = read("grain-bin-calculator.html");
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "’").replace(/&deg;/g, "°")
  .replace(/&minus;/g, "−").replace(/&times;/g, "×").replace(/&ldquo;|&rdquo;/g, '"').replace(/\s+/g, " ");

/* GSI 30 ft, 9 rings. Chart: 15,337 bu, 24 ft 2 in eave, 12 in plenum, 28 deg, 6%.
   Grain depth  = 24.1667 - 1 = 23.1667 ft
   Floor area   = pi x 15^2 = 706.858 ft2
   Cylinder     = 706.858 x 23.1667 = 16,375.6 ft3
   Peak, 28 deg = pi x 15^3 x tan28 / 3 = 10,602.9 x 0.53171 / 3 = 1,879.2 ft3
   Total        = 18,254.8 ft3 x 0.8036 = 14,669.5 bu x 1.06 = 15,549.7 bu (+1.4% vs chart)
   Plain, 25 deg peak, no pack: cone 1,648.1, total 18,023.6 ft3 = 14,483.8 bu (-5.6%) */
test("GSI 30 ft 9-ring bin, by hand", () => {
  const b = G.CHECK_BINS[0], r = G.checkBin(b);
  assert.equal(b.chart, 15337);
  near(r.grainH, 23.1667, "grain depth", 1e-3);
  near(r.dealer, 15549.7, "dealer setting");
  near(r.plain, 14483.8, "plain setting");
  near(r.dealerPct, 1.39, "vs chart", 0.01);
});

/* GSI 36 ft, 12 rings. Chart: 29,404 bu, 32 ft 2 in eave, 12 in plenum.
   Grain depth  = 31.1667 ft;  area = pi x 18^2 = 1,017.876 ft2
   Cylinder     = 1,017.876 x 31.1667 = 31,723.8 ft3
   Peak, 28 deg = pi x 18^3 x 0.53171 / 3 = 3,247.3 ft3
   Total        = 34,971.1 ft3 x 0.8036 = 28,102.8 x 1.06 = 29,788.9 bu (+1.3%)
   Plain: cone 2,847.9, total 34,571.7 ft3 = 27,781.8 bu (-5.5%) */
test("GSI 36 ft 12-ring bin, by hand", () => {
  const b = G.CHECK_BINS[1], r = G.checkBin(b);
  assert.equal(b.chart, 29404);
  near(r.dealer, 29788.9, "dealer setting");
  near(r.plain, 27781.8, "plain setting");
});

/* Brock 48 ft, 8 rings. Chart: 39,053 bu, 21 ft 6 in eave, counted from the eave as printed.
   Area = pi x 24^2 = 1,809.557 ft2;  cylinder = 1,809.557 x 21.5 = 38,905.5 ft3
   Peak, 28 deg = pi x 24^3 x 0.53171 / 3 = 7,697.3 ft3
   Total = 46,602.8 ft3 x 0.8036 = 37,450.0 x 1.06 = 39,697.0 bu (+1.6%)
   Plain: cone 6,750.5, total 45,656.0 ft3 = 36,689.1 bu (-6.1%) */
test("Brock 48 ft 8-ring bin, by hand", () => {
  const b = G.CHECK_BINS[2], r = G.checkBin(b);
  assert.equal(b.chart, 39053);
  near(r.dealer, 39697.0, "dealer setting");
  near(r.plain, 36689.1, "plain setting");
});

test("the dealer setting lands within 2% of every chart; the plain one 5 to 6.5% under", () => {
  for (const b of G.CHECK_BINS) {
    const r = G.checkBin(b);
    assert.ok(Math.abs(r.dealerPct) < 2, `${b.name} dealer ${r.dealerPct}`);
    const chartOverPlain = (b.chart / r.plain - 1) * 100;
    assert.ok(chartOverPlain >= 5 && chartOverPlain <= 6.5, `${b.name} chart over plain ${chartOverPlain}`);
  }
  assert.equal(G.DEALER.peakDeg, 28);
  assert.equal(G.DEALER.packPct, 6);
  assert.equal(G.PLAIN.peakDeg, 25);
  assert.equal(G.PLAIN.packPct, 0);
});

test("the page's check table is the module's numbers, cell for cell", () => {
  const tbody = PAGE.match(/id="dealer-check"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]).trim()));
  assert.equal(rows.length, 3);
  const f = (n) => Math.round(n).toLocaleString("en-US");
  const p = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1) + "%";
  G.CHECK_BINS.forEach((b, i) => {
    const r = G.checkBin(b);
    assert.equal(rows[i][0], b.name);
    assert.equal(rows[i][2], f(b.chart));
    assert.equal(rows[i][3], `${f(r.dealer)} (${p(r.dealerPct)})`);
    assert.equal(rows[i][4], `${f(r.plain)} (${p(r.plainPct)})`);
  });
});

test("the shipped default is unchanged: 30 x 24 peaked 14,957, level 13,633", () => {
  near(G.bushels(G.roundBin({ d: 30, grainH: 24, surface: "peaked" }).total, 0), 14957.1, "peaked");
  near(G.bushels(G.roundBin({ d: 30, grainH: 24, surface: "level" }).total, 0), 13632.8, "level");
  // dealer basis on the same bin, as the FAQ says: (16,964.6 + 1,879.2) x 0.8036 x 1.06 = 16,051
  near(G.bushels(G.roundBin({ d: 30, grainH: 24, surface: "peaked", peakDeg: 28 }).total, 6), 16051.5, "dealer");
});

test("test weight: 20,000 bin bushels of 54 lb corn = 19,286 market bushels", () => {
  near(G.marketBu(20000, 54, 56), 19285.7, "20,000 x 54 / 56");
  near(G.marketBu(20000, 56, 56), 20000, "standard test weight changes nothing", 1e-9);
});

test("shrink splits into water (NCH-61) and handling", () => {
  // NCH-61 worked example: 25% to 15.5% is 9.5 pts x 1.183 = 11.24% water
  const a = G.shrink(25, 15.5, 1.3);
  near(a.waterPerPt, 1.1834, "100 / 84.5", 1e-4);
  near(a.water, 11.24, "water", 0.01);
  near(a.total, 12.35, "9.5 x 1.3", 1e-9);
  near(a.handling, 1.11, "handling = total - water", 0.01);
  // The page's own example: 18% to 15.5% at 1.3 = 3.25% total, 2.96% water, 0.29% handling
  const b = G.shrink(18, 15.5, 1.3);
  near(b.total, 3.25, "total", 1e-9);
  near(b.water, 2.96, "water", 0.005);
  near(b.handling, 0.29, "handling", 0.005);
  assert.equal(G.shrink(14, 15.5, 1.3).total, 0, "dry grain does not shrink");
});

test("drying is charged per wet bushel", () => {
  // 3,000 wet bu, 2.5 pts, $0.035/pt/bu = $262.50 (on the 2,902.5 dry bu it would be $253.97)
  near(G.dryingCost(2.5, 0.035, 3000), 262.5, "wet bushels", 1e-9);
  const html = PAGE.slice(PAGE.indexOf("var G=window.AgGrainBin"));
  assert.match(html, /G\.dryingCost\(ptsToDry, dryCostPt, mktBu\)/, "page bills the wet market bushels");
  assert.doesNotMatch(html, /ptsToDry\*dryCostPt\*dryBu/, "never the dry bushels");
});

test("a hopper with an empty cylinder still holds its cone", () => {
  // 30 ft, 45 deg hopper: pi x 15^3 x 1 / 3 = 3,534.3 ft3 = 2,840.2 bu
  const h = G.hopperBin({ d: 30, grainH: 0, hopperDeg: 45, surface: "peaked" });
  near(h.total, 3534.3, "cone ft3", 0.1);
  near(G.bushels(h.total, 0), 2840.2, "bu");
  assert.equal(h.cyl, 0);
  assert.equal(h.adj, 0, "no peak on an empty cylinder");
});

test("hopper + draw: full funnel fits when the hopper is at least as steep as 25 deg", () => {
  // 30 ft, 45 deg, 2 ft in the cylinder: cyl 1,413.7 + hopper 3,534.3 - funnel 1,648.1 = 3,299.9 ft3
  const h = G.hopperBin({ d: 30, grainH: 2, hopperDeg: 45, surface: "draw" });
  near(h.total, 1413.7 + 3534.3 - 1648.1, "cyl + hopper - funnel", 0.2);
  // A flat floor is a 0 deg hopper: the same as the round-bin wedge
  const flat = G.hopperBin({ d: 30, grainH: 2, hopperDeg: 0, surface: "draw" });
  const round = G.roundBin({ d: 30, grainH: 2, surface: "draw" });
  near(flat.total, round.total, "0 deg hopper = flat floor", 1e-6);
});

test("round-bin draw wedge: the old hand check still holds", () => {
  // 30 ft bin with 2.4 ft at the wall: the wedge is 516 ft3, about 414 bu
  const v = G.roundBin({ d: 30, grainH: 2.4, surface: "draw" });
  near(v.total, 516, "wedge ft3", 1);
  near(G.bushels(v.total, 0), 414, "bu", 1);
});

test("sizing on 32 in and 44 in rings, and the 50,000 bu FAQ answer", () => {
  const at48 = (ring, dealer) => G.sizeOptions(50000, ring, dealer, 11).find((o) => o.d === 48);
  const d32 = at48(32, true), l32 = at48(32, false), l44 = at48(44, false);
  assert.equal(d32.rings, 11); assert.equal(G.ftIn(d32.eave), "29 ft 4 in");
  near(d32.bu, 51771, "48 ft, 11 rings, dealer basis", 1);
  assert.equal(l32.rings, 13); assert.equal(G.ftIn(l32.eave), "34 ft 8 in");
  assert.equal(l44.rings, 10); assert.equal(G.ftIn(l44.eave), "36 ft 8 in");
  const faq = text(PAGE.match(/<dt>What size bin do I need for 50,000 bushels\?<\/dt>\s*<dd>([\s\S]*?)<\/dd>/)[1]);
  assert.match(faq, /11 rings of 32 in \(29 ft 4 in eave\) holds about 51,800 bu/);
  assert.match(faq, /13 rings of 32 in \(34 ft 8 in\) or 10 rings of 44 in \(36 ft 8 in\)/);
  assert.doesNotMatch(faq, /35-ft eave/, "the old 48 x 35 answer is gone");
  assert.deepEqual([...G.RINGS_IN], [32, 44]);
  assert.match(PAGE, /name="ring"[^>]*value="32"/);
  assert.match(PAGE, /name="ring"[^>]*value="44"/);
});

test("the page: one copy of the math, the dealer setting, test weight, labels", () => {
  assert.match(PAGE, /<script src="\/components\/grain-bin\.js\?v=\d+"><\/script>/);
  assert.doesNotMatch(PAGE, /BU_PER_CUFT\s*=/, "the page must not grow its own bushel constant");
  assert.doesNotMatch(PAGE, /RING_FT\s*=\s*44/, "no hard-wired 44 in ring");
  assert.match(PAGE, /name="basis"[^>]*value="dealer"/);
  assert.match(PAGE, /Match my dealer&rsquo;s chart/);
  assert.match(PAGE, /id="testWt"/);
  assert.match(PAGE, /id="floorIn"/);
  assert.match(PAGE, /Dealer charts read about 5 to 6\.5% higher/);
  assert.doesNotMatch(PAGE, /result-label">Shrink Factor</, "the row shows a percent; it is not a factor");
  assert.match(PAGE, /result-label">Total shrink</);
  assert.match(PAGE, /id="rShrinkWater"/);
  assert.match(PAGE, /id="rShrinkHand"/);
  assert.doesNotMatch(PAGE, /if\(gH<=0\)\{cylVol=0; adjVol=0; hopperVol=0;\}/, "empty cylinder must not empty the hopper");
});

test("byline, date and sources are on the page", () => {
  assert.match(PAGE, /By <a href="\/about">Sigurd Lindquist<\/a>, Certified Crop Adviser \(CCA\) &middot; Updated <time datetime="2026-10-15">Oct 15, 2026<\/time>/);
  assert.match(PAGE, /"dateModified":"2026-10-15"/);
  for (const s of ["NCH-61", "doi.org/10.13031/trans.58.11033", "EP413.2", "grain-drying-considerations-fall", "gs401_40SeriesBins-Producer.pdf"])
    assert.ok(PAGE.includes(s), `source ${s}`);
  assert.doesNotMatch(PAGE, /K-State\/USDA WPACKING/, "the uncited 2-6% claim is gone");
  const visible = PAGE.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "");
  assert.doesNotMatch(visible, /—|&mdash;/, "no em dashes in what a reader sees");
});

/* Source sweep, Oct 15, 2026: the GSI brochure, NCH-61 and the two Bhadra
 * papers read in full (references branch). The GSI model 4002 table prints
 * 30 ft/9 rings 15,337 bu at 24'2" and 36 ft/12 rings 29,404 bu at 32'2", a
 * 12" plenum, "28 degree angle of repose and 6% compaction factor", and 32 in
 * rings (2'8" per ring). Brock's chart was not in the saved copy (home page
 * only), so its row says unverified. NCH-61 gives 1.2 to 1.5 per point. */
test("dealer rows and shrink range match the documents", () => {
  assert.match(PAGE, /model 4002 table: 30 ft, 9 rings, 15,337 bu at 24 ft 2 in; 36 ft, 12 rings, 29,404 bu at 32 ft 2 in/);
  assert.match(PAGE, /<tr><td>GSI 30 ft, 9 rings<\/td><td>24 ft 2 in, 12 in floor<\/td><td>15,337<\/td>/);
  assert.match(PAGE, /<tr><td>GSI 36 ft, 12 rings<\/td><td>32 ft 2 in, 12 in floor<\/td><td>29,404<\/td>/);
  assert.match(PAGE, /&ldquo;28 degree angle of repose and 6% compaction factor&rdquo;/);
  assert.equal(G.DEALER.peakDeg, 28); assert.equal(G.DEALER.packPct, 6);
  assert.equal((24 * 12 + 2) - (21 * 12 + 6), 32, "GSI chart: 8 to 9 rings adds 32 in");
  assert.match(PAGE, /<tr><td>Brock 48 ft, 8 rings \(unverified\)<\/td>/);
  assert.match(PAGE, /so the Brock row is unverified/);
  assert.doesNotMatch(PAGE, /GSI and Brock bins <a/);
  const faqs = PAGE.split("Buyers commonly figure 1.2 to 1.5 per point (Purdue NCH-61)").length - 1;
  assert.equal(faqs, 2, "FAQ and its JSON-LD say 1.2 to 1.5, as NCH-61 does");
  assert.doesNotMatch(PAGE, /1\.2 to 1\.4 per point/);
  assert.match(PAGE, /doi\.org\/10\.13031\/trans\.12645/);
});
