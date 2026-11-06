/* One sale filed once per parcel, each with the whole price (Nov 5, 2026): several parcels of one county sold the
 * same day for the same price, to the same buyer on every one, are one sale of their total acres. Indiana files one disclosure per
 * parcel, so Blackford County read one $2,701,640 sale of 3 parcels as 3 sales at up to $75,339 an acre.
 *   - the real cases (test/fixtures/land-one-price.json: Blackford County IN twice, merged; Hunterdon County NJ, kept
 *     apart: no buyer on file) through FSLand.onePrice (field-scout-land.js) and build_land_summary.one_price
 *   - the edge cases: unknown acres, buildings on one parcel, different buyers, month dates, non-market deeds
 *   - the land-sales pages and the Atlas use that one rule (saleRows ends with it)
 *
 *   node --test test/land-one-price.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const FX = JSON.parse(read("test/fixtures/land-one-price.json"));

function py(rows, today, st) {
  const code = ["import sys,json", "sys.path.insert(0,sys.argv[1])", "import build_land_summary as B",
    "d=json.load(sys.stdin)", "m=B.one_price(d['rows'],d['today'])",
    "print(json.dumps([[x.get('price'),x.get('acres'),x.get('ppa'),x.get('np'),x.get('cls'),bool(x.get('acUnsure')),x.get('pgrp'),B.land_type(x,d['st'])] for x in m]))"].join("\n");
  const r = spawnSync("python3", ["-c", code, join(ROOT, "scripts")], { input: JSON.stringify({ rows, today, st }), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const js = (rows, today, st) => F.onePrice(JSON.parse(JSON.stringify(rows)), today).map((x) =>
  [x.price, x.acres, x.ppa, x.np, x.cls, !!x.acUnsure, x.pgrp, F.landType(Object.assign({}, x, { st }))].map((v) => (v === undefined ? null : v)));

test("the real cases: one sale of the parcels' total acres, the same in Python and in the page code", () => {
  assert.equal(FX.cases.length, 3);
  for (const c of FX.cases.filter((x) => x.expect.n === 1)) {
    assert.ok(c.rows.length >= 2, `${c.state} ${c.date}: several parcels`);
    for (const r of c.rows) for (const k of Object.keys(r)) assert.ok(["date", "price", "acres", "cls", "np", "conv", "exempt", "acUnsure", "ppa", "fips", "bi"].includes(k), `fixture field ${k}`);
    const a = js(c.rows, c.today, c.state), b = py(c.rows, c.today, c.state);
    assert.deepEqual(a, b, `${c.state} ${c.date}: JS and Python differ`);
    assert.equal(a.length, c.expect.n);
    const [price, acres, ppa, np, cls, unsure, pgrp, kind] = a[0];
    assert.equal(price, c.price);
    assert.equal(acres, c.expect.acres);
    assert.equal(ppa, c.expect.ppa);
    assert.equal(ppa, Math.round(c.price / c.expect.acres), "one price over the total acres");
    assert.equal(np, c.expect.np);
    assert.equal(cls, c.expect.cls);
    assert.equal(kind, c.expect.kind);
    assert.equal(unsure, false);
    assert.equal(pgrp, c.rows.length);
    // before: each parcel read as a sale at the whole price
    assert.ok(Math.max(...c.rows.map((r) => r.ppa)) > ppa);
  }
  const [b1, b2, nj] = FX.cases;
  assert.equal(b1.expect.kind, "farm");
  assert.equal(b2.expect.kind, "bldg", "buildings on one parcel mark the sale");
  // New Jersey's deed abstracts carry no buyer: two parcels at one price on one day stay two sales
  assert.equal(nj.state, "NJ");
  assert.ok(nj.rows.every((r) => !("bi" in r)));
  assert.deepEqual(js(nj.rows, nj.today, "NJ"), py(nj.rows, nj.today, "NJ"));
  assert.equal(js(nj.rows, nj.today, "NJ").length, 2);
});

test("edge cases, the same in Python and in the page code", () => {
  const T = "2026-11-01";
  const P = (d, price, acres, o = {}) => Object.assign({ date: d, price, acres, cls: "4", ppa: acres ? Math.round(price / acres) : null, fips: "18009", conv: "Warranty Deed", bi: 1 }, o);
  const cases = [
    ["unknown acres on one parcel: one sale, acres uncertain, no $/acre", [P("2026-08-28", 900000, 40), P("2026-08-28", 900000, null, { np: 2, acUnsure: true })], 1],
    ["no buyer on file: separate sales", [P("2026-08-28", 500000, 40, { bi: null }), P("2026-08-28", 500000, 40, { bi: null })], 2],
    ["different buyers at one price: separate sales", [P("2026-08-28", 500000, 40, { bi: 1 }), P("2026-08-28", 500000, 40, { bi: 2 })], 2],
    ["month dates (Florida): left alone", [P("2026-08-01", 500000, 40, { dm: 1 }), P("2026-08-01", 500000, 40, { dm: 1 })], 2],
    ["other days or counties: separate", [P("2026-08-28", 500000, 40), P("2026-08-29", 500000, 40), P("2026-08-28", 500000, 40, { fips: "18001" })], 3],
    ["a non-market deed is never merged", [P("2026-08-28", 500000, 40), P("2026-08-28", 500000, 40, { conv: "Quit Claim Deed" })], 2],
    ["a small bare parcel with a big one: bare land of their acres", [P("2026-06-26", 800000, 5, { cls: "5", fips: "50021" }), P("2026-06-26", 800000, 179.78, { cls: "5", fips: "50021" })], 1],
  ];
  for (const [name, rows, n] of cases) {
    const a = js(rows, T, "IN"), b = py(rows, T, "IN");
    assert.deepEqual(a, b, name);
    assert.equal(a.length, n, name);
  }
  const byName = (k) => cases.find((c) => c[0].startsWith(k))[1];
  const u = js(byName("unknown acres"), T, "IN")[0];
  assert.equal(u[2], null); assert.equal(u[5], true);
  const v = js(byName("a small bare parcel"), T, "VT")[0];
  assert.equal(v[1], 184.78); assert.equal(v[7], "farm");
});

test("saleRows ends with the one-price step in both copies", () => {
  assert.match(read("field-scout-land.js"), /return FSLand\.onePrice\(merged, today\);/);
  assert.match(read("scripts/build_land_summary.py"), /return one_price\(out, today\)/);
});
