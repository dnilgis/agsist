/* Census tenure, Oct 20 2026 fault.
 *
 * data/tenure/tenure.json held 1997-2017 county rows that were one tenure class
 * (part owners), not all farms: they added up to 46-78% of every state's TOTAL
 * (US about 500M of 900M acres) and read 55% rented at the median county against
 * 35% in 2022. scripts/fetch_tenure.py now takes TOTAL county rows only and
 * withholds a state's county-year unless its counties add up to the state total.
 *
 *   1. The shipped file: every state-year that has county figures adds up to
 *      85-102% of that state's TOTAL, and the nation is the sum of the states.
 *   2. The parser selftest passes (it fails on the old single-row rule).
 *   3. Field Scout never prints a (D)-suppressed half as 100% or 0% rented
 *      (Wakulla FL 2022 is [null, 2384]).
 *
 *   node --test test/tenure-oct20.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const T = JSON.parse(read("data/tenure/tenure.json"));

test("county figures add up to their state's census total in every year they are published", () => {
  const sums = {};
  for (const c of Object.values(T.counties)) {
    for (const [y, p] of Object.entries(c.y)) {
      if (p[0] == null || p[1] == null) continue;
      const k = c.st + " " + y;
      sums[k] = (sums[k] || 0) + p[0] + p[1];
    }
  }
  const bad = [];
  for (const [k, v] of Object.entries(sums)) {
    const [st, y] = k.split(" ");
    const s = T.states[st] && T.states[st].y[y];
    const r = s && s[0] != null && s[1] != null ? v / (s[0] + s[1]) : null;
    if (r == null || r < 0.85 || r > 1.02) bad.push(`${k}: ${r == null ? "no state total" : r.toFixed(3)}`);
  }
  assert.deepEqual(bad, [], "county-years that are not the whole state");
  // The real case: Story IA 2017 was 209,028 ac (64.1% rented) against 299,244 ac in 2022.
  assert.deepEqual(Object.keys(T.counties["19169"].y), ["2022"]);
  assert.deepEqual(T.counties["19169"].y["2022"], [134824, 164420]);
  // The 2022 county count did not shrink, and partial-2022 counties keep their record
  // (the Atlas reads [x, null] as "size unknown", a missing record as no farmland).
  const full22 = Object.values(T.counties).filter((c) => c.y["2022"] && c.y["2022"][0] != null && c.y["2022"][1] != null).length;
  assert.ok(full22 >= 3000, `${full22} complete 2022 counties`);
  assert.deepEqual(T.counties["12129"].y["2022"], [null, 2384]);
});

test("the national series is the sum of the states, 1997 to 2022", () => {
  for (const y of T.years.map(String)) {
    const n = T.national[y];
    assert.ok(n && n[0] != null && n[1] != null, `national ${y}`);
    let s = 0;
    for (const st of Object.values(T.states)) { const p = st.y[y]; if (p && p[0] != null && p[1] != null) s += p[0] + p[1]; }
    const r = (n[0] + n[1]) / s;
    assert.ok(r > 0.98 && r < 1.02, `${y}: national/states ${r.toFixed(3)}`);
  }
});

test("fetch_tenure.py selftest passes", () => {
  const out = execFileSync("python3", ["scripts/fetch_tenure.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /SELFTEST OK: pre-2022 non-TOTAL county rows withheld/);
});

test("Field Scout slices hold no pre-2022 county year", () => {
  const dir = ROOT + "data/field-scout/county/";
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    const s = JSON.parse(readFileSync(dir + f, "utf8"));
    for (const [k, c] of Object.entries((s.tenure || {}).counties || {})) {
      assert.deepEqual(Object.keys(c.y).filter((y) => y !== "2022"), [], `${f} ${k}`);
    }
  }
});

test("Field Scout picks the latest census with both parts published", () => {
  const src = read("field-scout-read.js");
  const i = src.indexOf("// FS-TENYEAR-BEGIN"), j = src.indexOf("// FS-TENYEAR-END");
  assert.ok(i >= 0 && j > i);
  const tenureYear = new Function(src.slice(i, j) + "; return tenureYear;")();
  assert.equal(tenureYear(T.counties["12129"].y), null, "Wakulla FL: owned (D), no share");
  assert.equal(tenureYear({ 2017: [10, 30], 2022: [null, 2384] }), 2017);
  assert.equal(tenureYear(T.counties["19169"].y), 2022);
  assert.equal(tenureYear({}), null);
  assert.match(src, /var ly=tenureYear\(trec\.v\.y\), pair=ly!=null\?trec\.v\.y\[ly\]:null;/);
});
