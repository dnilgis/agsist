/* One crop-removal table (2026-10-17 audit N3). /breakeven priced corn at
 * 0.37 lb P2O5 and 0.24 lb K2O a bushel while /fertilizer and /nutrient-removal
 * printed UW A2809 Table 4.2: 0.38 and 0.29. Every page that prices a bushel's
 * P and K must read the same numbers, and the scripts take them from
 * components/nutrient-removal.js through scripts/crop_removal.py. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const NR = require("../components/nutrient-removal.js");
const read = (f) => readFileSync(ROOT + f, "utf8");

// A2809 Table 4.2 grain rows, typed from refs/uw-a2809-2026.txt
const A2809 = { corn: [0.38, 0.29], soybeans: [0.8, 1.4], wheat: [0.5, 0.35] };
const ROW = { corn: "corn_grain", soybeans: "soy_grain", wheat: "wheat_grain" };

test("nutrient-removal.js grain rows are A2809 Table 4.2", () => {
  for (const [crop, [p, k]] of Object.entries(A2809)) {
    const row = NR.CROPS.find((c) => c.id === ROW[crop]);
    assert.ok(row, ROW[crop]);
    assert.deepEqual([row.p, row.k], [p, k], crop);
  }
});

test("the scripts read the same table", () => {
  const py = JSON.parse(execFileSync("python3", ["scripts/crop_removal.py"], { cwd: ROOT, encoding: "utf8" }));
  for (const [crop, [p, k]] of Object.entries(A2809)) assert.deepEqual(py[crop].slice(1), [p, k], crop);
  const progs = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json;sys.path.insert(0,'scripts');import build_fert_prices as B;print(json.dumps({k:v['per_bu'] for k,v in B.PROGRAMS.items()}))"],
    { cwd: ROOT, encoding: "utf8" }));
  for (const [crop, [p, k]] of Object.entries(A2809)) assert.deepEqual(progs[crop].slice(1), [p, k], crop);
});

test("/fertilizer's fertility bill uses the table", () => {
  const m = /var CROPS=\{corn:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)[^}]*\},soybean:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)[^}]*\},wheat:\{[^}]*p2o5:([\d.]+),k2o:([\d.]+)/.exec(read("fertilizer.html"));
  assert.ok(m, "fertilizer.html CROPS");
  assert.deepEqual(m.slice(1).map(Number), [...A2809.corn, ...A2809.soybeans, ...A2809.wheat]);
});

test("/breakeven bakes the table and says so", () => {
  const be = read("breakeven.html");
  const m = /var FERT=\{[^}]*r:\{corn:\[([\d.,]+)\],soybeans:\[([\d.,]+)\],wheat:\[([\d.,]+)\]\}/.exec(be);
  assert.ok(m, "breakeven FERT const");
  assert.deepEqual(m[1].split(",").map(Number).slice(1), A2809.corn);
  assert.deepEqual(m[2].split(",").map(Number).slice(1), A2809.soybeans);
  assert.deepEqual(m[3].split(",").map(Number).slice(1), A2809.wheat);
  assert.doesNotMatch(be, /0\.37 lb P|0\.24 lb K|0\.37 and 0\.24/);
  assert.match(be, /0\.90, 0\.38 and 0\.29 lb a bushel/);
});

test("the shared price file's programs are priced at the table", () => {
  const d = JSON.parse(read("data/fertilizer-prices.json"));
  const c = d.programs && d.programs.corn;
  if (!c) return; // no live price: nothing priced, nothing to check
  assert.equal(c.p_lb, Math.round(c.yield * A2809.corn[0]));
  assert.equal(c.k_lb, Math.round(c.yield * A2809.corn[1]));
});
