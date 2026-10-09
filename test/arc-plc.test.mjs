/* The ARC or PLC calculator math (components/arc-plc.js) and the file it
 * reads (data/arc-plc-2027.json, built by scripts/build_arc_plc.py).
 *
 * The shipped file is run in a bare context (no document), which loads only
 * the math, so a green run checks the copy the browser runs. Every expected
 * value below was worked by hand; the arithmetic is in the comment beside it.
 *
 *   node --test test/arc-plc.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/arc-plc.js", "utf8"), ctx);
const A = ctx.window.AgArcPlc;
const D = JSON.parse(readFileSync(ROOT + "data/arc-plc-2027.json", "utf8"));
const near = (a, b, msg, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
const county = (st, fips) => D.states[st].c.find((r) => r[0] === fips);

test("PLC rate: ERP minus the higher of price or loan rate, never below zero", () => {
  near(A.plcRate(4.34, 4.0, 2.42), 0.34, "4.34 - 4.00");
  near(A.plcRate(4.34, 2.0, 2.42), 1.92, "price under the loan rate pays down to the loan rate: 4.34 - 2.42");
  assert.equal(A.plcRate(4.34, 4.5, 2.42), 0);
});

test("ARC-CO rate: 90% guarantee, 12% cap", () => {
  // BR 180 x 4.96 = 892.80; G 803.52; actual 162 x 4.00 = 648.00; shortfall 155.52 > cap 107.136
  near(A.arcRate(180, 4.96, 162, 4.0, 2.42), 107.136, "capped");
  // actual 170 x 4.40 = 748.00; 803.52 - 748 = 55.52 under the cap
  near(A.arcRate(180, 4.96, 170, 4.4, 2.42), 55.52, "uncapped");
  // actual 180 x 4.47 = 804.60 > 803.52
  assert.equal(A.arcRate(180, 4.96, 180, 4.47, 2.42), 0);
  // a price under the loan rate counts as the loan rate: 803.52 - 170 x 2.42 = 392.12, capped 107.136
  near(A.arcRate(180, 4.96, 170, 1.0, 2.42), 107.136, "loan floor then cap");
});

test("the built file's ERPs and benchmark prices re-derive from its own MYA inputs", () => {
  const exp = { corn: [4.34, 4.96], soybeans: [10.62, 12.11], wheat: [6.35, 6.98] };
  for (const [k, [erp, bp]] of Object.entries(exp)) {
    const c = D.crops[k];
    const myas = D.mya_years.map((y) => c.mya[String(y)]);
    assert.equal(myas.length, 5);
    assert.equal(A.erpCalc(myas, c.statutory, 0.88, 1.15), c.erp.erp, `${k} ERP JS vs build`);
    assert.equal(c.erp.erp, erp, `${k} ERP by hand`);
    assert.equal(A.benchmarkPrice(myas, c.erp.erp), c.bp.value, `${k} benchmark JS vs build`);
    assert.equal(c.bp.value, bp, `${k} benchmark by hand`);
  }
  // corn: 2021-2025 = 6.00, 6.54, 4.55, 4.24, 4.16; drop 6.54 and 4.16; (6.00+4.55+4.24)/3 = 4.93; x 0.88 = 4.3384
  assert.deepEqual(D.mya_years, [2021, 2022, 2023, 2024, 2025]);
  assert.equal(D.crops.corn.erp.dropped_low, 4.16);
  // wheat: (7.63+6.96+5.52)/3 x 0.88 = 5.899, below the 6.35 statutory price
  assert.equal(D.crops.wheat.erp.binding, "statutory");
  // the 115% cap: 4.10 x 1.15 = 4.715 -> 4.72
  assert.equal(A.erpCalc([10, 10, 10, 10, 10], 4.1, 0.88, 1.15), 4.72);
});

test("Chippewa County WI corn, by hand", () => {
  const r = county("WI", "55017");
  // 170.3, 162.0, 167.1, 181.0, 173.1: drop 162.0 and 181.0; 510.5 / 3 = 170.17
  assert.equal(r[3].by, 170.2);
  assert.deepEqual(r[4].miss, [2023], "soybeans: NASS skipped 2023, so no estimate");
  const c = { erp: 4.34, bp: 4.96, loan: 2.42, by: 170.2, py: 150 };
  const p = A.pay(c, 4.0, 170.2);
  near(p.plc, 0.34 * 150 * 0.85, "PLC 43.35"); // 43.35
  // BR 844.192, G 759.7728, actual 680.80, shortfall 78.9728 x 0.85 = 67.1269
  near(p.arc, 67.12688, "ARC 67.13", 1e-6);
  // ARC capped (101.303) below 3.8688; PLC 150 x (4.34 - P) beats it below 3.6647
  const runs = A.ranges(c, 170.2);
  assert.deepEqual(Array.from(runs, (x) => [x.w, x.lo, x.hi]), [["plc", 242, 366], ["arc", 367, 446], ["none", 447, 448]]); // scan ends one cent past 0.9 x 4.96 = 4.464
  assert.deepEqual(Array.from(A.rangeText(runs)), [
    "PLC pays more at $3.66 or lower.", "ARC-CO pays more from $3.67 to $4.46.", "Neither pays at $4.47 or higher."]);
});

test("Story County IA soybeans, by hand", () => {
  const r = county("IA", "19169");
  // 63.6, 60.0, 64.1, 63.2, 63.6: drop 60.0 and 64.1; 190.4 / 3 = 63.47
  assert.equal(r[4].by, 63.5);
  const c = { erp: 10.62, bp: 12.11, loan: 6.82, by: 63.5, py: 52 };
  const p = A.pay(c, 10.2, 63.5);
  near(p.plc, 0.42 * 52 * 0.85, "PLC 18.56", 1e-9);
  // BR 768.985, G 692.0865, actual 647.70, shortfall 44.3865 x 0.85 = 37.7285
  near(p.arc, 37.728525, "ARC 37.73", 1e-6);
  const t = A.rangeText(A.ranges(c, 63.5));
  // cap 92.2782 reached below 9.4458; PLC 52 x (10.62 - P) beats it below 8.8454; ARC stops at 692.0865/63.5 = 10.899
  assert.deepEqual(Array.from(t), ["PLC pays more at $8.84 or lower.", "ARC-CO pays more from $8.85 to $10.89.", "Neither pays at $10.90 or higher."]);
});

test("Reno County KS wheat with a typed official benchmark, by hand", () => {
  const r = county("KS", "20155");
  assert.ok(r, "Reno County is in the file");
  assert.equal(D.crops.wheat.county_est, false, "no county wheat estimate; the reader types the official one");
  const c = { erp: 6.35, bp: 6.98, loan: 3.72, by: 45, py: 38 };
  const p = A.pay(c, 5.5, 40);
  near(p.plc, 0.85 * 38 * 0.85, "PLC 27.455", 1e-9);
  // BR 314.10, G 282.69, actual 220.00, shortfall 62.69 > cap 37.692; x 0.85 = 32.0382
  near(p.arc, 32.0382, "ARC capped 32.04", 1e-9);
  // PLC 38 x (6.35 - P) > 37.692 below 5.358; ARC stops at 282.69 / 40 = 7.067
  assert.deepEqual(Array.from(A.rangeText(A.ranges(c, 40))),
    ["PLC pays more at $5.35 or lower.", "ARC-CO pays more from $5.36 to $7.06.", "Neither pays at $7.07 or higher."]);
});

test("the break-even at the benchmark yield depends only on PLC yield / benchmark", () => {
  const a = A.rangeText(A.ranges({ erp: 4.34, bp: 4.96, loan: 2.42, by: 100, py: 80 }, 100));
  const b = A.rangeText(A.ranges({ erp: 4.34, bp: 4.96, loan: 2.42, by: 170.2, py: 136.16 }, 170.2));
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.equal(a[0], "PLC pays more at $3.59 or lower.");
});

test("winner: ties and zeros", () => {
  assert.equal(A.winner(0, 0), "none");
  assert.equal(A.winner(10.004, 10.001), "same");
  assert.equal(A.winner(5, 4), "plc");
  assert.equal(A.winner(4, 5), "arc");
});

test("no em dash in the calculator's words", () => {
  const src = readFileSync(ROOT + "components/arc-plc.js", "utf8");
  assert.ok(!src.includes("\u2014"));
});
