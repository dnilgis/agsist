// Farmland Atlas head-to-head fixes (2026-10-15).
// 1. The county corn trend was called "15-yr" but the fit window (the 15
//    calendar years ending in the projected year) never holds a yield for the
//    projected year itself, so the most any fit has is 14 years (n=14 in
//    data/cash-rent). The label now says what the fit has.
// 2. Where the same-practice trend behind rent per bushel is withheld, the key
//    tile said "trend withheld" while the yield section printed a 2008-2025
//    trend. The tile now names what is withheld.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const py = (code) => execFileSync("python3", ["-c", code], { cwd: path.join(root, "scripts"), encoding: "utf8" }).trim();

test("the trend label names no more years than any fit can hold", () => {
  const lab = py("import county_yield as C; print(C.label_trend(2026))");
  const m = /^(\d+)-yr trend \(projected 2026\)$/.exec(lab);
  assert.ok(m, lab);
  const said = +m[1];
  let maxN = 0;
  for (const f of readdirSync(path.join(root, "data/cash-rent")).filter((x) => /^[A-Z]{2}\.json$/.test(x))) {
    const d = JSON.parse(read("data/cash-rent/" + f));
    for (const c of d.counties || []) for (const v of Object.values(c.yield || {})) if (v && v.n > maxN) maxN = v.n;
  }
  assert.ok(maxN > 0, "no fitted trends found in data/cash-rent");
  assert.equal(said, maxN, `label says ${said}-yr, the longest fit in the data has ${maxN} years`);
});

test("no shipped page or script still says 15-yr trend", () => {
  const files = ["components/rent-calc.js", "farmland-atlas/sheet.html", "farmland-atlas/data.html",
    "scripts/build_atlas_pages.py", "scripts/build_state_rent_pages.py", "scripts/county_yield.py",
    "farmland-atlas/iowa/story-county.html", "farmland-atlas/wisconsin/barron-county.html", "rent/iowa.html"];
  for (const f of files) assert.ok(!/15-yr/.test(read(f)), `${f} still says 15-yr`);
});

test("a withheld rent-per-bushel trend is named as that, not as the yield trend", () => {
  const b = read("farmland-atlas/wisconsin/barron-county.html");
  // Barron prints a 2008-2025 yield trend in the corn section ...
  assert.match(b, /Trend, 2008–2025<\/span><span class="r">\+2\.0 bu\/ac a year/);
  // ... so the tile and the section must say the withheld item is the rent-per-bushel trend
  assert.ok(!/· trend withheld:/.test(b), "tile still says a bare 'trend withheld'");
  assert.match(b, /rent-per-bushel trend withheld: county yield mixes irrigated and dryland acres/);
  assert.match(b, /Trend for rent per bushel<\/span>/);
  assert.ok(!/14-yr trend<\/span><span class="r">—/.test(b));
});
