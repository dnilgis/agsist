/* The one market-sale rule (Oct 18, 2026), shared by Field Scout's Sold land nearby, the comp
 * report and the Farmland Atlas builder.
 *
 *   node --test test/land-rule.test.mjs
 *
 * field-scout-land.js (FSLand.saleRows, marketSale, statOK) and scripts/build_land_summary.py
 * (sale_rows, market_sale, stat_ok) run on the same rows and must agree row for row: the
 * made-up rows in test/fixtures/land-rule.json (every case worked by hand below), then real
 * county files where they are on disk. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const FX = JSON.parse(read("test/fixtures/land-rule.json"));
const PY = read("scripts/build_land_summary.py");

const jsRule = (f, today) => F.saleRows(F.rowObjs(f), today).map((r) => [r.doc, String(r.date || "").slice(0, 10), Math.round(F.num(r.price) || 0), F.num(r.acres), r.ppa, F.marketSale(r, today), F.statOK(r), r.grp || 1]);
function pyRule(path, today) {
  const r = spawnSync("python3", [join(ROOT, "scripts/build_land_summary.py"), "--rule", path, today], { encoding: "utf8", maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("the patterns are one text in both languages", () => {
  assert.equal(/^NON_MARKET = r"(.*)"$/m.exec(PY)[1], F.NON_MARKET.source);
  assert.equal(/^PARTIAL = r"(.*)"$/m.exec(PY)[1], F.PARTIAL.source);
  for (const [k, v] of [["ONE_PARCEL_MAX_AC", 640], ["PPA_FLOOR", 500], ["GROUP_DAYS", 31], ["GROUP_LEGAL", 40]]) {
    assert.equal(F[k], v, k);
    assert.match(PY, new RegExp("^" + k + " = " + v + " ", "m"), k + " in Python");
  }
});

test("fixture rows: JavaScript and Python agree row for row", () => {
  const py = pyRule(join(ROOT, "test/fixtures/land-rule.json"), FX.today);
  assert.deepEqual(FX.files.map((f) => jsRule(f, FX.today)), py);
});

test("fixture rows, worked by hand", () => {
  const out = Object.fromEntries(jsRule(FX.files[0], FX.today).map((x) => [x[0], x]));
  const mk = (d) => out[d][5], ppa = (d) => out[d][4];
  assert.ok(mk("R01") && ppa("R01") === 10000, "plain sale: $800,000 / 80 ac");
  for (const d of ["R02", "R03"]) assert.equal(mk(d), false, d + ": a share (undivided, less than full interest)");
  for (const d of ["R04", "R05", "R06", "R09", "R10", "R11"]) assert.equal(mk(d), false, d + ": court, court cut short, foreclosure, installment contract, trade, exchange");
  for (const d of ["R07", "R08"]) assert.equal(mk(d), true, d + ": auction and a neighbor buying stay in");
  assert.deepEqual(out.R12.slice(3, 7), [null, null, true, false], "one parcel of 700 acres: acres uncertain, listed, no $/acre");
  assert.deepEqual(out.R13.slice(4, 7), [250, true, false], "$250/ac: listed, never in a middle or a low");
  assert.equal(mk("R14"), false, "dated after today");
  // McLean-style split filing: three deeds Aug 26 to 28, each 80 ac, one buyer: $300,000 + $300,000 + $200,000
  assert.deepEqual(out.R15, ["R15", "2025-08-26", 800000, 80, 10000, true, true, 3]);
  assert.ok(!out.R16 && !out.R17, "the other two deeds are inside R15");
  assert.equal(out.R18[7], 1, "the same parcel 36 days after the first deed is a sale of its own");
  assert.deepEqual(out.R19.slice(2), [220000, 20, null, true, false, 2], "two buyers: listed once, total price, no $/acre");
  assert.equal(out.R21[7], 2, "no parcel number: the same first 40 letters of the legal");
  assert.ok(out.R23 && !out.R24, "the same date, price, parcel, seller and buyer is one record");
  assert.equal(out.R25[5], false, "no acres");
  assert.equal(mk("R26"), false, "related parties");
  assert.equal(mk("R27"), false, "fee exempt");
  assert.equal(Object.keys(out).filter((d) => d === "R01").length, 1, "the same document twice is one row");
  assert.deepEqual(out.R28.slice(2, 8), [500000, 40, 12500, true, true, 2], "two half-interest deeds, same acres, one buyer: one whole sale");
  assert.deepEqual(out.R30.slice(3, 6), [null, null, false], "share deeds that do not add up to one whole: a share, out");
  assert.equal(out.R33[5], true, "two parcels, acres uncertain: listed with no $/acre");
  const other = jsRule(FX.files[1], FX.today);
  assert.equal(other.length, 1, "the same parcel number in another county is another sale");
  assert.match(F.groupText(F.saleRows(F.rowObjs(FX.files[0]), FX.today).find((r) => r.doc === "R15")), /^filed as 3 deeds from Aug 26, 2025 to Aug 28, 2025, \$800,000 in all$/);
});

test("deed types cut short in the state file still read, and the flag words the fetch adds are caught", () => {
  const base = { price: 400000, acres: 80, exempt: 0, date: "2025-01-01", legal: "" };
  const ms = (conv, legal) => F.marketSale(Object.assign({}, base, { conv, legal: legal || "" }), "2026-10-18");
  for (const c of ["COURT O", "Sale, Court Order Or Fore", "COURT ORDER", "Sale, Court Ordered", "FORECLOS", "Sale, Foreclosure", "TRADE", "Warranty Deed, Exchange", "Sheriff's Deed",
    "Sale, Less Than Full Interest", "Warranty Deed, Installment Contract", "Sale, Easem", "Warranty Deed, Land Contract Satisfied", "State Highway Warranty Deed, Sale", "Deed In Lieu Of Foreclosure"]) assert.equal(ms(c), false, c);
  for (const c of ["Sale", "Sale, Auction", "Sale, Adjacent Owner", "Sale, Buyer Owns Adjacent Land", "Land Contract, Sale", "Warranty Deed", "Trustee Deed"]) assert.equal(ms(c), true, c);
  assert.equal(ms("Warranty Deed", "HIS UNDIVIDED ONE-THIRD INTEREST IN THE SW SW"), false);
  assert.equal(ms("Warranty Deed", "A 1/2 INTEREST IN THE SE"), false);
});

test("real county files: JavaScript and Python agree row for row (McLean, Pulaski, Dodge, Tippecanoe, Champaign, Ozaukee)", () => {
  let n = 0;
  for (const [st, fips] of [["il", "17113"], ["il", "17153"], ["wi", "55027"], ["in", "18157"], ["il", "17019"], ["wi", "55089"]]) {
    const p = `data/land/${st}/${fips}.json`;
    if (!existsSync(join(ROOT, p))) continue;
    const f = JSON.parse(read(p));
    const today = String(f.fetched_utc).slice(0, 10);
    assert.deepEqual(jsRule(f, today), pyRule(join(ROOT, p), today)[0], p);
    n++;
  }
  assert.ok(n > 0 || !existsSync(join(ROOT, "data/land/il")), "no real file was compared");
});

test("real split filings are one sale (McLean 16-08-100-001, Pulaski 04-23-200-004, Dodge Feb 23, 2026)", () => {
  const one = (st, fips, pick) => {
    const p = `data/land/${st}/${fips}.json`;
    if (!existsSync(join(ROOT, p))) return null;
    const f = JSON.parse(read(p)), today = String(f.fetched_utc).slice(0, 10);
    return F.saleRows(F.rowObjs(f), today).filter(pick);
  };
  const mc = one("il", "17113", (r) => r.pid === "16-08-100-001" && r.date >= "2025-08-26" && r.date <= "2025-08-28");
  if (mc) { assert.equal(mc.length, 1); assert.equal(mc[0].grp, 5); assert.equal(mc[0].price, 1240000); }
  const pu = one("il", "17153", (r) => r.pid === "04-23-200-004" && r.date === "2025-06-09");
  if (pu) { assert.equal(pu.length, 1); assert.equal(pu[0].grp, 9); }
  const dg = one("wi", "55027", (r) => r.date === "2026-02-23" && (r.grp ? r.grpPrices.includes(74004) : r.price === 74004 || r.price === 625996));
  if (dg) { assert.equal(dg.length, 1); assert.equal(dg[0].price, 700000); }
});
