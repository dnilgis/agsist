/* The ARC or PLC calculator math (components/arc-plc.js) and the files it
 * reads (data/arc-plc.json and data/arc-plc/<ST>.json, built by
 * scripts/build_arc_plc.py from USDA NASS prices and FSA's official county file).
 *
 * The shipped file is run in a bare context (no document), which loads only
 * the math, so a green run checks the copy the browser runs. Every expected
 * value below was worked by hand; the arithmetic is in the comment beside it.
 *
 *   node --test test/arc-plc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/arc-plc.js", "utf8"), ctx);
const A = ctx.window.AgArcPlc;
const D = JSON.parse(readFileSync(ROOT + "data/arc-plc.json", "utf8"));
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const one = (erp, bp, loan, py, by, y) => ({ erp, bp, loan, py, parts: [{ w: 1, by, y }] });
const text = (c) => Array.from(A.rangeText(A.ranges(c)));
const state = (st) => {
  const p = ROOT + `data/arc-plc/${st}.json`;
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};

test("PLC rate: ERP minus the higher of price or loan rate, never below zero", () => {
  near(A.plcRate(4.34, 4.0, 2.42), 0.34, "4.34 - 4.00");
  near(A.plcRate(4.34, 2.0, 2.42), 1.92, "under the loan rate pays down to the loan rate: 4.34 - 2.42");
  assert.equal(A.plcRate(4.34, 4.5, 2.42), 0);
});

test("ARC-CO rate: 90% guarantee, 12% cap, loan-rate floor", () => {
  // BR 180 x 4.96 = 892.80; G 803.52; actual 162 x 4.00 = 648.00; shortfall 155.52 > cap 107.136
  near(A.arcRate(180, 4.96, 162, 4.0, 2.42), 107.136, "capped");
  // 803.52 - 170 x 4.40 = 55.52
  near(A.arcRate(180, 4.96, 170, 4.4, 2.42), 55.52, "uncapped");
  assert.equal(A.arcRate(180, 4.96, 180, 4.47, 2.42), 0);
  near(A.arcRate(180, 4.96, 170, 1.0, 2.42), 107.136, "loan floor then cap");
});

test("cents round half up, as the build script does", () => {
  assert.equal(A.cents(0.125), 13);
  assert.equal(A.cents(27.455), 2746); // 27.455 is 27.45499.. in binary: +0.5 then floor still gives 2746
});

test("both years' ERPs and benchmark prices re-derive from the built file's own inputs", () => {
  const exp = { 2026: { corn: [4.42, 5.03], soybeans: [10.71, 12.17], wheat: [6.35, 6.98] },
                2027: { corn: [4.34, 4.96], soybeans: [10.62, 12.11], wheat: [6.35, 6.98] } };
  for (const [y, crops] of Object.entries(exp)) {
    assert.deepEqual(Array.from(D.years[y].window), [y - 6, y - 5, y - 4, y - 3, y - 2]);
    for (const [k, [erp, bp]] of Object.entries(crops)) {
      const c = D.years[y].crops[k];
      const myas = D.years[y].window.map((yr) => c.mya[String(yr)]);
      assert.equal(A.erpCalc(myas, c.statutory, 0.88, 1.15), c.erp.erp, `${y} ${k} ERP JS vs build`);
      assert.equal(c.erp.erp, erp, `${y} ${k} ERP by hand`);
      assert.equal(A.benchmarkPrice(myas, c.erp.erp), c.bp.value, `${y} ${k} benchmark JS vs build`);
      assert.equal(c.bp.value, bp, `${y} ${k} benchmark by hand`);
    }
  }
  // 2027 corn: 6.00, 6.54, 4.55, 4.24, 4.16; drop 6.54 and 4.16; (6.00+4.55+4.24)/3 = 4.93; x 0.88 = 4.3384
  // 2026 corn: 4.53, 6.00, 6.54, 4.55, 4.24; drop 6.54 and 4.24; (4.53+6.00+4.55)/3 = 5.0267; x 0.88 = 4.4235
  assert.equal(A.erpCalc([10, 10, 10, 10, 10], 4.1, 0.88, 1.15), 4.72, "115% cap: 4.10 x 1.15 = 4.715 -> 4.72");
});

test("payment and crossover, single practice, by hand", () => {
  // 2026 corn, BY 170.2, PLC yield 150, price 4.00, county yield 170.2
  const c = one(4.42, 5.03, 2.42, 150, 170.2, 170.2);
  const p = A.pay(c, 4.0);
  near(p.plc, 0.42 * 150 * 0.85, "PLC 53.55");
  // BR 856.106, G 770.4954, actual 680.80, shortfall 89.6954 x 0.85 = 76.24109
  near(p.arc, 76.24109, "ARC 76.24", 1e-6);
  // ARC cap 102.73272 reached below (770.4954-102.73272)/170.2 = 3.9234; PLC 150 x (4.42 - P) beats it below 3.7351
  assert.deepEqual(text(c), ["PLC pays more at $3.73 or lower.", "ARC-CO pays more from $3.74 to $4.52.", "Neither pays at $4.53 or higher."]);
});

test("irrigated and non-irrigated weighted by the farm's irrigated share, by hand", () => {
  // 30% irrigated: BY 197.23 and 166.32, BP 5.03, county yields at benchmark, price 4.00
  const c = { erp: 4.42, bp: 5.03, loan: 2.42, py: 150, parts: [{ w: 0.3, by: 197.23, y: 197.23 }, { w: 0.7, by: 166.32, y: 166.32 }] };
  // irr: G 0.9 x 992.0669 = 892.86021, actual 788.92, short 103.94021; non: G 0.9 x 836.5896 = 752.93064, actual 665.28, short 87.65064
  // weighted: 0.3 x 103.94021 + 0.7 x 87.65064 = 92.53751; x 0.85 = 78.65688
  near(A.pay(c, 4.0).arc, 78.656884, "blended ARC", 1e-5);
});

test("the scan cannot run long, whatever is typed", () => {
  const c = one(4.42, 5.03, 2.42, 150, 170.2, 0.001);
  const runs = A.ranges(c);
  assert.ok(runs[runs.length - 1].hi <= Math.ceil(5.03 * 150), JSON.stringify(runs[runs.length - 1]));
});

test("input checks", () => {
  const msgs = (v, ref) => Array.from(A.checks(v, ref), (m) => m.msg);
  assert.deepEqual(msgs({ p: 410 }, { erp: 4.34 }), ["Did you mean $4.10 per bushel?"]);
  assert.match(msgs({ p: 1 }, { erp: 4.34 })[0], /far from the \$4\.34 reference price/);
  assert.deepEqual(msgs({ py: 200 }, { erp: 4.34, by: 170 }), ["PLC yield is usually below the county average. Is this your APH? Use the PLC yield on your FSA-156EZ."]);
  assert.deepEqual(msgs({ base: 0 }, { erp: 4.34 }), ["Base acres must be more than zero."]);
  const tiny = Array.from(A.checks({ y: 10 }, { erp: 4.34, by: 170 }));
  assert.equal(tiny.length, 1);
  assert.equal(tiny[0].drop, true);
});

test("without FSA's 2026 file, no county carries a benchmark the calculator could use", (t) => {
  if (D.fsa) return t.skip("official file loaded");
  const ia = state("IA");
  assert.ok(ia && ia.c.length > 50, "Iowa counties listed for typed benchmarks");
  for (const c of ia.c) assert.deepEqual(Object.keys(c.k), [], `${c.n} has no benchmark`);
  assert.ok(ia.c.some((c) => c.plc && c.plc.corn > 0), "FSA county average PLC yields present");
});

test("FSA official county figures, when the file is loaded", (t) => {
  if (!D.fsa) return t.skip("no FSA file in data/fsa");
  assert.equal(D.fsa.py, 2026);
  const ia = state("IA");
  assert.ok(ia && ia.c.length > 50, "Iowa has FSA counties");
  for (const c of ia.c) for (const es of Object.values(c.k)) for (const e of es) assert.ok(e.by > 0 && ["all", "irr", "non"].includes(e.d));
});

test("scenario engine, 8 hand-worked years", () => {
  // ERP 4.00, BP 5.00, loan 2.00, PLC yield 100, benchmark 100, center $4.00
  const ratios = { 2015: 1.0, 2016: 0.75, 2017: 1.25, 2018: 1.25, 2019: 1.0, 2020: 0.5, 2021: 1.1, 2022: 0.9 };
  const dy = { 2015: 1.0, 2016: 1.0, 2017: 1.0, 2018: 0.8, 2019: 1.2, 2020: 1.0, 2021: 0.9, 2022: 1.1 };
  const c = { erp: 4, bp: 5, loan: 2, py: 100, parts: [{ w: 1, by: 100, dy }] };
  const v = A.scenarios(c, 4, ratios);
  // PLC pays 85 (2016, $3.00), 170 (2020, $2.00), 34 (2022, $3.60): mean 289 / 8 = 36.125
  near(v.plc, 36.125, "mean PLC");
  // ARC: G = 450, cap 60 x .85 = 51: 42.5, 51, 0, 42.5, 0, 51, 45.9, 45.9: mean 278.8 / 8 = 34.85
  near(v.arc, 34.85, "mean ARC");
  assert.equal(v.plcWins, 2); assert.equal(v.arcWins, 4);
  // differences -42.5, 34, 0, -42.5, 0, 119, -45.9, -11.9: SD 54.99, SE 19.44; gap 1.275 < 2 x SE
  near(v.se, 19.4408, "SE", 1e-3);
  assert.equal(v.verdict, "close");
  const fixed = A.scenarios(c, 4, ratios, 3.0);
  near(fixed.plc, 85, "PLC at $3.00"); near(fixed.arc, 51, "ARC at $3.00");
  assert.equal(fixed.verdict, "plc");
  const seven = Object.fromEntries(Object.entries(ratios).filter(([t]) => t !== "2022"));
  assert.equal(A.scenarios(c, 4, seven).verdict, "withheld", "fewer than 8 years");
});

test("the calculator and the county page give the same typical-farm verdict (Chippewa WI corn, non-irrigated)", (t) => {
  if (!D.fsa) return t.skip("no FSA file");
  const wi = state("WI");
  const cty = wi.c.find((c) => c.f === "55017");
  const e = cty.k.corn.find((x) => x.d === "non");
  const cr = D.years["2026"].crops.corn;
  const v = A.scenarios({ erp: cr.erp.erp, bp: cr.bp.value, loan: cr.loan, py: cty.plc.corn, parts: [{ w: 1, by: e.by, dy: e.dy }] }, cr.scen.center, cr.scen.ratios);
  const page = readFileSync(ROOT + "arc-plc/wisconsin/chippewa-county.html", "utf8");
  const m = /Corn, non-irrigated:<\/b> ([^(]+)\(est\. \$([\d.,]+) PLC vs \$([\d.,]+) ARC-CO/.exec(page);
  assert.ok(m, "quick answer present");
  assert.equal(v.plc.toFixed(2), m[2]); assert.equal(v.arc.toFixed(2), m[3]);
  assert.equal(v.n >= 8, true);
});

test("no em dash in the calculator's words", () => {
  assert.ok(!readFileSync(ROOT + "components/arc-plc.js", "utf8").includes("—"));
});
