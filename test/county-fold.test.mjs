/* One county code fold (god's-eye build 1, Nov 9 2026): scripts/county_fold.py, imported by every
 * county builder. Before it the fold lived in four places that disagreed (build_geo_crosswalk EXTRA,
 * build_farmland_atlas FIPS_ALIAS, atlas_geometry FIPS_RENAMED, fetch_atlas_crp FIPS_RENAME).
 *
 *   node --test test/county-fold.test.mjs
 *
 * Real cases: FSA writes 29193 for Ste. Genevieve MO (29186) and 46113 for Oglala Lakota SD (46102); the
 * Drought Monitor writes Connecticut's planning regions (09110 Capitol), which cross the old county lines
 * and are kept as published, with no county value. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const HOME = "scripts/county_fold.py";

// A module-level table of county codes: NAME = { "ddddd": "ddddd" | ("ddddd", ...) | dict(to=["ddddd"]) ... }
// with at least two such pairs before the closing brace.
function aliasTables(src) {
  const out = [];
  for (const m of src.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/gm)) {
    const start = m.index + m[0].length;
    let depth = 1, end = start;
    for (; end < src.length && depth; end++) depth += src[end] === "{" ? 1 : src[end] === "}" ? -1 : 0;
    const body = src.slice(start, end);
    const pairs = [...body.matchAll(/"(\d{5})"\s*:\s*[^,\n"]{0,40}"(\d{5})"/g)];
    if (pairs.length >= 2) out.push(m[1]);
  }
  return out;
}

test("county fold: no script but county_fold.py defines its own county code table", () => {
  const files = readdirSync(join(ROOT, "scripts")).filter((n) => n.endsWith(".py"));
  assert.ok(files.length >= 300, `only ${files.length} scripts read; the folder moved`);
  const bad = [];
  for (const n of files) {
    const p = "scripts/" + n;
    if (p === HOME) continue;
    const src = read(p);
    for (const name of aliasTables(src)) bad.push(`${p}: ${name}`);
    for (const m of src.matchAll(/^(FIPS_(?:ALIAS|RENAMED?|RETIRED))\s*=\s*\{\s*(?:"|#|$)/gm)) bad.push(`${p}: ${m[1]} is a literal table`);
  }
  assert.deepEqual(bad, [], "a county builder carries its own alias table; import fold/resolve from scripts/county_fold.py");
  // the detector bites: it finds the one real table, and a copy of the old Atlas table
  assert.deepEqual(aliasTables(read(HOME)).filter((n) => n === "TABLE"), ["TABLE"], "the detector finds county_fold.TABLE");
  assert.deepEqual(aliasTables('FIPS_ALIAS = {\n    "46113": "46102",\n    "02270": "02158",\n}\n'), ["FIPS_ALIAS"]);
  assert.deepEqual(aliasTables('FIPS_RENAMED = {\n    "46113": ("46102", "Oglala Lakota"),\n    "02270": ("02158", "Kusilvak"),\n}\n'), ["FIPS_RENAMED"]);
});

test("county fold: every county builder imports the one fold", () => {
  for (const p of ["scripts/build_geo_crosswalk.py", "scripts/build_farmland_atlas.py", "scripts/atlas_geometry.py",
                   "scripts/fetch_atlas_crp.py", "scripts/fetch_atlas_storms.py", "scripts/join_report.py",
                   "scripts/build_arc_plc.py", "scripts/fetch_drought_county_week.py"])
    assert.match(read(p), /^from county_fold import /m, `${p} imports scripts/county_fold.py`);
});

test("county fold: real cases, and the published table is the same table", () => {
  execFileSync("python3", [join(ROOT, HOME), "--selftest"], { stdio: "pipe" });
  const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(join(ROOT, "scripts"))})
from county_fold import fold, resolve, TABLE, published
print(json.dumps({"f": {c: fold(c) for c in ["29193", "46113", "09110", "27138", "19001"]},
  "r": {c: list(resolve(c)) for c in ["29193", "09110"]}, "t": {c: published(r) for c, r in TABLE.items()}}))`;
  const got = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }));
  assert.equal(got.f["29193"], "29186", "Ste. Genevieve: 29193 -> 29186");
  assert.equal(got.f["46113"], "46102", "Shannon -> Oglala Lakota: 46113 -> 46102");
  assert.equal(got.f["09110"], "09110", "a CT planning region keeps its code");
  assert.deepEqual(got.r["09110"], [[], "reshape", true], "09110 is lossy and reaches no county");
  assert.equal(got.f["27138"], "27138", "an FSA office part is not filed as the county");
  assert.equal(got.f["19001"], "19001");
  const xw = JSON.parse(read("data/ids/geo-crosswalk.json")).codes;
  assert.deepEqual(xw, got.t, "data/ids/geo-crosswalk.json is county_fold.TABLE (run scripts/build_geo_crosswalk.py)");
});
