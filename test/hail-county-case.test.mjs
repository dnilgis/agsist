/* Hail county ranks: one county, one row, joined BEFORE the cut to 12 (panel F1, 2026-10-20).
 *
 * IEM spells one county several ways. scripts/fetch_hail.py keyed its tally on the raw
 * spelling, so data/hail/state-counties.json (generated 2026-10-01) has Iowa as
 * LINN 65 + Linn 62, SCOTT 63 + Scott 57, Story 46 + STORY 41, and its table shows 9
 * counties, not 12: finalize_counties cut to 12 first and generate_hail_states merged
 * after, so any half below 12th place was gone. The merged peak month was the bigger
 * half's, not the months added together.
 *
 * The Iowa counts below are those real rows. IEM is not reachable from the sandbox, so the
 * report rows are rebuilt from them: one LSR per report, the county as IEM spelled it.
 *   node --test test/hail-county-case.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const py = (code) => JSON.parse(execFileSync("python3", ["-I", "-c", "import sys,json; sys.path.insert(0, 'scripts'); " + code], { cwd: ROOT, encoding: "utf8" }));

// [spelling, {month: reports}] from data/hail/state-counties.json, Iowa, generated 2026-10-01
// (totals as filed; the month split of each half is set so its filed peak holds).
const IOWA = [
  ["LINN", { 4: 40, 6: 25 }],              // 65, peak Apr
  ["Linn", { 4: 32, 5: 30 }],              // 62, peak Apr
  ["SCOTT", { 4: 25, 6: 24, 3: 14 }],      // 63, peak Apr
  ["Scott", { 3: 21, 6: 20, 4: 16 }],      // 57, peak Mar; together Jun 44 > Apr 41
  ["Johnson", { 4: 63 }],
  ["Polk", { 7: 61 }],
  ["Story", { 4: 46 }],
  ["STORY", { 3: 41 }],
  ["Pottawattamie", { 4: 41 }],
  ["Dubuque", { 3: 41 }],
  ["Marion", { 6: 39 }],
  ["Black Hawk", { 4: 38 }],
  // below 12th in the split file, both halves cut: together 60, sixth
  ["WOODBURY", { 5: 30 }],
  ["Woodbury", { 5: 30 }],
  ["Clinton", { 6: 20 }], ["Cedar", { 6: 19 }], ["Benton", { 6: 18 }],
];

function rows() {
  const out = [];
  for (const [county, months] of IOWA) {
    for (const [m, n] of Object.entries(months)) {
      for (let i = 0; i < n; i++) {
        out.push({ type: "H", magnitude: i % 2 ? "1.00" : "0.75", state: "IA", county,
          valid: `2025${String(m).padStart(2, "0")}15${String(18 + (i % 4)).padStart(2, "0")}00` });
      }
    }
  }
  return out;
}

const ranked = () => py(`import fetch_hail as f; acc={}; f.tally_counties(${JSON.stringify(rows())}, acc); ` +
  `print(json.dumps(f.finalize_counties(acc,[2025],end_iso='2025-12-31')['IA']))`);

test("Iowa: LINN 65 + Linn 62 is one Linn row of 127, ranked first, before the cut to 12", () => {
  const ia = ranked();
  assert.equal(ia.length, 12, "12 counties in the table, not 9");
  assert.deepEqual(ia.slice(0, 2).map((r) => [r.county, r.total]), [["Linn", 127], ["Scott", 120]]);
  const names = ia.map((r) => r.county.toLowerCase());
  assert.equal(new Set(names).size, 12, "no county twice");
  assert.deepEqual(ia.find((r) => r.county === "Story").total, 87);
  const wb = ia.find((r) => r.county === "Woodbury");
  assert.ok(wb && wb.total === 60, "Woodbury's two halves of 30 were both below 12th; joined first, it ranks");
  assert.equal(ia.indexOf(wb), 5);
  assert.ok(names.includes("cedar") && !names.includes("benton"), "the cut still keeps 12: Cedar 12th in, Benton 13th out");
});

test("Iowa: the months are added before the peak is read (Scott Apr 41 + Jun 44 is Jun, not the bigger half's Apr)", () => {
  const ia = ranked();
  const scott = ia.find((r) => r.county === "Scott");
  assert.equal(scott.peak, "Jun");
  assert.deepEqual(scott.months, [0, 0, 35, 41, 0, 44, 0, 0, 0, 0, 0, 0]);
  assert.equal(ia.find((r) => r.county === "Linn").peak, "Apr");
  for (const r of ia) assert.equal(r.months.reduce((a, b) => a + b, 0), r.total, r.county + ": months add to the total");
  assert.equal(ia.find((r) => r.county === "Linn").dmg_pct, 50, "damaging share over both spellings");
});

test("the spelling shown is the mixed-case one even when the all-caps half is bigger", () => {
  const out = py("import fetch_hail as f; print(json.dumps([f.display_name('linn', {'LINN': 65, 'Linn': 62}), " +
    "f.display_name('o brien', {'O BRIEN': 3}), f.display_name('Polk', None)]))");
  assert.deepEqual(out, ["Linn", "O BRIEN", "Polk"]);
});

test("a file built before the fix: the state page merge adds the months when both halves carry them", () => {
  const out = py("import generate_hail_states as g; r=g.merge_counties([" +
    "{'county':'SCOTT','total':63,'avg':13.1,'peak':'Apr','dmg_pct':57,'months':[0,0,14,25,0,24,0,0,0,0,0,0]}," +
    "{'county':'Scott','total':57,'avg':11.9,'peak':'Mar','dmg_pct':35,'months':[0,0,21,16,0,20,0,0,0,0,0,0]}," +
    "{'county':'LINN','total':65,'avg':13.6,'peak':'Apr','dmg_pct':35},{'county':'Linn','total':62,'avg':12.9,'peak':'Apr','dmg_pct':52}], 4.8); print(json.dumps(r))");
  assert.deepEqual(out.map((r) => [r.county, r.total, r.peak]), [["Linn", 127, "Apr"], ["Scott", 120, "Jun"]]);
  assert.equal(out[1].dmg_pct, 47);
  assert.ok(!("months" in out[0]), "no months on a row whose halves never had them");
});
