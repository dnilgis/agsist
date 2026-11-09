/* The /prf panel fixes of Nov 9, 2026 (notes/panels prf skeptic, section 4), each pinned on the real case it was
 * found on. No browser needed: the panel's own helpers run in a vm, and the pages are read as files.
 *
 *   node --test test/prf-panel-nov9.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const box = { window: {}, Buffer };
for (const f of ["prf-math", "prf-optimize", "prf-optimize-ui"]) vm.runInNewContext(read(`components/${f}.js`), box);
const O = box.window.AgPrfOptimize, U = box.window.AgPrfOptUI;
const OPT = JSON.parse(read("data/prf/opt.json"));
const FX = JSON.parse(read("test/fixtures/prf/opt-grid-28914.json"));
const lim = FX.lim;
const INPUT = { index: FX.index, rates: FX.rates[90], coverage: 90, subsidy: FX.subsidy["90"], min: lim.map((p) => (p ? p[0] : null)),
  max: lim.map((p) => (p ? p[1] : null)), valid: lim.map(Boolean), avgMm: FX.avgMm, lastComplete: FX.last_complete, grid: FX.grid };

test("fix 1: the real outlook.json shape ({status, issued}) prints CPC's status, and the 28914 pick does not move", () => {
  const real = { enso: { status: "El Nino Advisory", issued: "2026-10-08" } };
  const line = U.ensoLine(real.enso, OPT);
  assert.equal(line, "NOAA’s Climate Prediction Center: El Nino Advisory, Oct 8. Our test across grids found no edge from El Niño or La Niña, so it does not move the pick.");
  assert.equal(OPT.predictors.enso.kept, false, "the published test rejects ENSO; if that changes, this wording must change");
  const o = O.outlookFor(real, FX.grid);
  assert.equal(o.enso, null, "a status is never turned into a phase that tilts the pick");
  const plain = O.recommend(INPUT, { objective: "net" });
  assert.deepEqual(Array.from(plain.rec.split), [0, 30, 0, 0, 0, 0, 0, 0, 0, 70, 0], "grid 28914's pick, as the panel saw it");
  assert.ok(!plain.forecast, "no forecast pick from the real file");
  /* the shipped file is the case */
  const shipped = JSON.parse(read("data/prf/outlook.json")).enso;
  if (shipped && shipped.status) assert.match(U.ensoLine(shipped, OPT), /Advisory|Watch|Not Active|La Ni|El Ni/);
});

test("fix 1: no reader-set ENSO choice, and the header no longer claims a current outlook (Sig, Nov 9)", () => {
  const ui = read("components/prf-optimize-ui.js");
  assert.ok(!ui.includes("prf-opt-enso"), "the El Nino or La Nina select is gone");
  assert.ok(!/history and current outlook/.test(ui + read("scripts/make_prf_html.py") + read("prf.html")), "header wording");
  assert.match(U.NOTE, /history and the rates point to, not advice/);
  /* the engine still names the reading when a caller passes one */
  const r = O.recommend(INPUT, { objective: "net", enso: "el-nino" });
  assert.ok(r.forecast.notes.some((t) => /^The El Niño or La Niña reading (moved|did not change)/.test(t)), r.forecast.notes.join(" | "));
});

test("fix 2: the steadier line compares against the pick on the card (28914 with El Nino: 61, not 54)", () => {
  const r = O.recommend(INPUT, { objective: "net", steadier: true, enso: "el-nino" });
  assert.ok(r.forecast && r.steadier, "the case has both a forecast pick and a steadier option");
  const w = U.steadierWords(r.forecast, r.steadier);
  assert.equal(w.paid, "Paid in 70 of 75 years here, against 61 for the pick.");
  const gap = 100 * (r.forecast.record.mean - r.steadier.record.mean);
  assert.ok(gap < 0 && w.gap.endsWith(" more"), "beside the shown pick the steadier option averages more, not $0.46 less: " + w.gap);
  assert.equal(U.steadierWords(r.rec, r.steadier).paid, "Paid in 70 of 75 years here, against 54 for the pick.", "the record-alone pick keeps its own count");
  assert.ok(/steadierWords\(pk, st\)/.test(read("components/prf-optimize-ui.js")), "the card passes the pick it shows");
});
