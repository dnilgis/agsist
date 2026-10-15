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

// 3. The newest public land value (NASS state survey) beside the 2022 census.
test("the state land value fetcher is wired into the monthly atlas run", () => {
  const wf = read(".github/workflows/farmland-atlas.yml");
  assert.match(wf, /python fetch_atlas_state_value\.py --selftest/);
  assert.match(wf, /NASS_API_KEY: \$\{\{ secrets\.NASS_API_KEY \}\}\n\s+run: python scripts\/fetch_atlas_state_value\.py/);
  assert.match(wf, /git add -A data\/atlas/);   // where the fetcher writes
  const src = read("scripts/fetch_atlas_state_value.py");
  assert.match(src, /OUT = "data\/atlas\/state-value\.json"/);
  assert.match(read("scripts/build_atlas_pages.py"), /DATA, "state-value\.json"/);
});

test("a county page names the survey value as the state's, and only when it is newer", () => {
  const out = py(`
import build_atlas_pages as B
class W: svalue = {"IA": {"cropland": {"2025": 10400.0, "2026": 10700.0}}}
s = B.state_survey(W, "IA", 2022)
print(B.survey_facts(s, "Iowa"))
print(B.state_survey(W, "IA", 2026))
print(B.state_survey(W, "WI", 2022))`);
  assert.match(out, /Iowa cropland, 2026 state survey/);
  assert.match(out, /\$10,700\/ac/);
  assert.match(out, /\+2\.9% from 2025/);          // 10,700 / 10,400 = +2.88%
  assert.doesNotMatch(out, /Story|county value/i);
  assert.match(out, /\nNone\nNone$/);              // census year not older: nothing; no state row: nothing
});

// 4. The hub's 16 layer groups sit under four kinds, so the first look is four choices.
test("every hub layer group sits under exactly one of four kinds, land first", () => {
  const h = read("farmland-atlas.html");
  const groups = new Set([...h.matchAll(/\{key:'[a-z0-9_]+',grp:'([^']+)'/g)].map((m) => m[1]));
  assert.ok(groups.size >= 16, `found ${groups.size} groups`);
  const m = /var FAMILIES=(\[[\s\S]*?\]\]\]);/.exec(h);
  assert.ok(m, "FAMILIES list missing");
  const fams = JSON.parse(m[1].replace(/'/g, '"'));
  assert.equal(fams.length, 4);
  assert.deepEqual(fams.map((f) => f[0]), ["Land & rent", "Yield & insurance", "Weather & water", "Farm & programs"]);
  const seen = new Map();
  for (const [fam, gs] of fams) for (const g of gs) {
    assert.ok(!seen.has(g), `${g} is in two kinds`);
    assert.ok(groups.has(g), `${g} is listed but no layer uses it`);
    seen.set(g, fam);
  }
  for (const g of groups) assert.ok(seen.has(g), `${g} has no kind`);
  assert.equal(seen.get("Land value"), "Land & rent");
  assert.match(h, /var CUR='val';/);          // the map still opens on land value
  // yield layers are under yield, not under rent
  assert.match(h, /\{key:'yield_slope',grp:'Corn yield'/);
  assert.match(h, /<div class="fa-fams" id="fa-fams" role="group"/);
});
