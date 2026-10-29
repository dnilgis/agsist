/* Section key for land sales (Oct 29, 2026, property panel build step 5).
 *
 *   node --test test/land-keys.test.mjs
 *
 * Two copies read a section from a legal description: FSLand.strParts in field-scout-land.js (the
 * browser, for the parcel under a field and the sale panel) and scripts/land_keys.py legal_parts
 * (the "str" column it writes into data/land/<st>/<fips>.json). These tests run both over the same
 * 900 real legals (test/fixtures/land-keys-legals.json, name-free) and fail on any difference.
 * The comps rows are real Adams County, Wisconsin returns (data/land/wi/55001.json, Oct 29),
 * names left out. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const require = createRequire(import.meta.url);
const F = require(join(ROOT, "field-scout-land.js"));
const FIX = JSON.parse(read("test/fixtures/land-keys-legals.json")).rows;

test("the fixture is real legals from three states, hits and misses both", () => {
  const by = (st) => FIX.filter((r) => r.st === st);
  for (const st of ["WI", "IL", "IN"]) {
    assert.ok(by(st).length >= 250, st + " rows: " + by(st).length);
    assert.ok(by(st).filter((r) => r.key).length >= 150, st + " keyed");
    assert.ok(by(st).filter((r) => !r.key).length >= 50, st + " misses");
  }
  assert.ok(FIX.filter((r) => r.key && r.key.includes("?")).length >= 100, "Indiana shorthand with unwritten directions");
});

test("strOf reads every fixture legal exactly as before the strParts split", () => {
  let n = 0;
  for (const r of FIX) { assert.equal(F.strOf(r.legal), r.strOf, r.legal); n++; }
  assert.ok(n >= 900);
});

test("FSLand.strKey matches the frozen key for every legal", () => {
  for (const r of FIX) assert.equal(F.strKey(r.legal), r.legal_key, r.legal);
});

test("the Python copy reads every fixture legal the same as the browser", () => {
  const py = JSON.parse(execFileSync("python3", ["-c",
    "import json,sys; sys.path.insert(0,'scripts'); import land_keys as K; " +
    "rows=json.load(open('test/fixtures/land-keys-legals.json'))['rows']; " +
    "print(json.dumps([[K.legal_key(r['legal']), K.key_for(r['st'], r['legal'], r['fips'])] for r in rows]))"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 24 }));
  assert.equal(py.length, FIX.length);
  let diff = 0;
  FIX.forEach((r, i) => {
    if (py[i][0] !== F.strKey(r.legal)) diff++;
    assert.equal(py[i][0], F.strKey(r.legal), "legal_key vs strKey: " + r.legal);
    assert.equal(py[i][1], r.key, "key_for: " + r.legal);
  });
  assert.equal(diff, 0);
});

test("python selftest passes", () => {
  const out = execFileSync("python3", ["scripts/land_keys.py", "--selftest"], { cwd: ROOT, encoding: "utf8" });
  assert.match(out, /all passed/);
});

test("a real Wisconsin legal reads Section 29, T15N, R6E", () => {
  // data/land/wi/55001.json doc 600390 (Adams County, Sep 26, 2026)
  const legal = "The Northeast One-quarter (1/4) of the Southwest One-quarter (1/4) of Section Twenty-nine (29), Township fifteen (15) North, Range Six (6) E";
  assert.equal(F.strKey(legal), "29-15N-6E");
  assert.equal(F.strOf(legal), "Section 29, T15N, R6E");
  // cut at our 140-character copy before the range direction: no key, nothing guessed
  assert.equal(F.strKey("The Southwest Quarter of the Northeast Quarter (SW 1/4 NE 1/4) of Section Thirteen (13), Township Sixteen (16) North, Range Twenty-two (22) "), null);
});

test("sectionRel: same, touching (corners and township lines), not touching", () => {
  const R = F.sectionRel;
  assert.equal(R("29-15N-6E", "29-15N-6E"), "same");
  assert.equal(R("29-15N-6E", "32-15N-6E"), "next");   // south
  assert.equal(R("29-15N-6E", "33-15N-6E"), "next");   // southeast corner
  assert.equal(R("29-15N-6E", "28-15N-6E"), "next");   // east
  assert.equal(R("29-15N-6E", "20-15N-6E"), "next");   // north
  assert.equal(R("29-15N-6E", "24-15N-6E"), null);
  assert.equal(R("29-15N-6E", "27-15N-6E"), null);     // two over
  assert.equal(R("29-15N-6E", "29-15N-7E"), null);     // same number, next township east
  assert.equal(R("12-33N-10W", "7-33N-9W"), "next");   // across a range line, west ranges
  assert.equal(R("1-33N-10W", "6-33N-9W"), "next");
  assert.equal(R("6-33N-10W", "1-33N-11W"), "next");
  assert.equal(R("36-33N-10W", "1-32N-10W"), "next");  // across a township line
  assert.equal(R("6-1N-1E", "1-1N-1W"), "next");       // across the meridian
  assert.equal(R("6-1N-1E", "6-1N-1W"), null);
  assert.equal(R("36-1N-1E", "1-1S-1E"), "next");      // across the base line
  assert.equal(R("1-1N-1E", "36-1S-1E"), null);
  assert.equal(R("29-15N-6E-4", "29-15N-6E-3"), null); // two meridians
  assert.equal(R("29-15N-6E-4", "29-15N-6E"), "same"); // one names it, one does not
  assert.equal(R(null, "29-15N-6E"), null);
});

test("sectionRel: a key with unwritten directions stays in its own county and township", () => {
  const R = F.sectionRel;
  assert.equal(R("17-11?-5?", "17-11N-5E", true), "same");
  assert.equal(R("17-11?-5?", "16-11?-5?", true), "next");
  assert.equal(R("17-11?-5?", "17-11?-5?", false), null);   // another county
  assert.equal(R("1-11?-5?", "6-11?-4?", true), null);      // across a range line: the direction decides
  assert.equal(R("17-11?-5W", "17-11N-5E", true), null);
});

// Real Adams County, Wisconsin rows (names left out). Town centers from the file's munis.
const SPRING = ["Springville town", 43.778, -89.7876], ROME = ["Rome town", 44.2038, -89.821];
const COLS = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "str", "exempt"];
const ADAMS = {
  state: "WI", county: "Adams", fips: "55001", acres_rule: 2, cols: COLS, munis: { 0: SPRING, 4: SPRING, 3: ROME },
  rows: [
    ["600390", "2026-09-26", 71000, 40.0, null, 1, "6", "Warranty Deed, Sale; land only", "032-01031-0000", "0", "The Northeast One-quarter (1/4) of the Southwest One-quarter (1/4) of Section Twenty-nine (29), Township fifteen (15) North, Range Six (6) E", "29-15N-6E", 0],
    ["596105", "2026-02-25", 350000, 37.5, null, 1, "4", "Warranty Deed, Sale", "032-00846-0010", "4", "The Southwest 1/4 of the Southeast 1/4 of Section 23, Township 15 North, Range 6 East, in the Town of Springville, Adams County, Wisconsin, ", "23-15N-6E", 0],
    ["564161", "2021-06-11", 128000, 40.0, null, 1, "4", "Warranty Deed, Sale", "032-00866-0000", "4", "The Southwest Quarter of the Southwest Quarter (SW 1/4 SW 1/4) of Section Twenty-Four (24), Township Fifteen (15) North, Range Six (6) East,", "24-15N-6E", 0],
    ["567285", "2021-10-16", 10000, 39.8, null, 1, "4", "Quit Claim Deed, Related Parties, Sale", "032-01148-0000", "4", "The Southwest Quarter of the Southwest Quarter (SW1/4-SW1/4) of Section Thirty-Three (33), Township Fifteen (15) North, Range Six (6) East, ", "33-15N-6E", 0],
    ["999001", "2025-06-01", 200000, 40.0, null, 1, "4", "Warranty Deed, Sale", "032-09999-0000", "3", "SEC 29 T15N R6E (made up: the same key 30 miles off, a test of the distance guard)", "29-15N-6E", 0],
  ],
};
// Every row but 999001 is as the file has it (the 567285 quit claim shows with "every deed type").

test("Field Scout comps: the reader's own section first, then touching ones, then today's order", () => {
  const rows = F.rowObjs(ADAMS);
  // the field's parcel is 032-01031-0000; its recorded transfer (600390) names Section 29, T15N, R6E
  const mine = F.mySections([{ ids: ["032-01031-0000"], legal: null }], rows, "55001");
  assert.deepEqual(mine, [{ k: "29-15N-6E", fips: "55001" }]);
  const field = { lat: 43.80, lng: -89.79 };
  const list = F.filterComps(rows, { sort: "date", dir: "desc", all: true }, field, "2026-10-29");
  assert.deepEqual(list.map((r) => r.doc), ["600390", "596105", "999001", "567285", "564161"], "today's order: newest first");
  const ranked = F.rankBySection(list, mine);
  assert.deepEqual(ranked.map((r) => r.doc), ["600390", "567285", "596105", "999001", "564161"]);
  assert.deepEqual(ranked.map((r) => r.secRel || null), ["same", "next", null, null, null]);
  // the made-up far row carries the same key but sits 29 miles off, in another town: never marked
  assert.ok(list.find((r) => r.doc === "999001").mi > F.SEC_NEAR_MI);
  // the reader sorted by price: their order stands, the marks stay
  const byPrice = F.filterComps(rows, { sort: "ppa", dir: "desc", all: true }, field, "2026-10-29");
  const kept = F.rankBySection(byPrice, mine, true);
  assert.deepEqual(kept.map((r) => r.doc), byPrice.map((r) => r.doc));
  assert.equal(kept.filter((r) => r.secRel).length, 2);
  // no section known for the field: today's order, nothing marked
  assert.deepEqual(F.rankBySection(list, []).map((r) => r.doc), list.map((r) => r.doc));
  assert.equal(F.rankBySection(list, []).filter((r) => r.secRel).length, 0);
  // a parcel map that carries the legal gives the key too
  assert.deepEqual(F.mySections([{ ids: [], legal: "NE SW SEC 29 T15N R6E" }], rows, "55001"), [{ k: "29-15N-6E", fips: "55001" }]);
});

test("the comps table says 'same section' / 'next section' and the note says how it was read", () => {
  const rows = F.rankBySection(F.filterComps(F.rowObjs(ADAMS), { all: true }, { lat: 43.80, lng: -89.79 }, "2026-10-29"),
    [{ k: "29-15N-6E", fips: "55001" }]);
  const html = F.compsTable(rows, 40, { detail: true });
  assert.equal((html.match(/same section/g) || []).length, 1);
  assert.equal((html.match(/next section/g) || []).length, 1);
  assert.match(F.secNote(3, true), /^3 sales are in the section your parcel.s record names or one touching it, listed first\./);
  assert.doesNotMatch(F.secNote(3, true) + html, /—/, "no em dash");
});

test("the section key column lives only in data/land/ (robots-blocked) and the card wires it", () => {
  assert.match(read("robots.txt"), /Disallow:\s*\/data\/land\//);
  const src = read("field-scout-land.js");
  const rc = src.slice(src.indexOf("function renderComps()"), src.indexOf("function compsShell("));
  assert.match(rc, /FSLand\.mySections\(S\.parcels, S\.sales\.rows, S\.fips\)/);
  assert.match(rc, /FSLand\.rankBySection\(list, mine,/);
  const fetchPy = read("scripts/fetch_land_sales.py");
  const build = fetchPy.slice(fetchPy.indexOf("def build("), fetchPy.indexOf("def fetch("));
  assert.match(build, /land_keys\.add_column\(doc, GEO\)/, "the writer adds the column to every county file");
  // the sale pages' list columns (indexed) never carry it
  const sales = read("scripts/build_land_sales.py");
  const lc = /LIST_COLS\s*=\s*\[([^\]]*)\]/.exec(sales);
  assert.ok(lc, "LIST_COLS found");
  assert.doesNotMatch(lc[1], /"str"/);
});

test("the sale panel shows an Indiana shorthand key and says which directions the legal leaves out", () => {
  const f = { state: "IN", county: "Adams", fips: "18001", cols: ["doc", "date", "price", "acres", "np", "cls", "conv", "pid", "muni", "legal", "str", "exempt"],
    munis: {}, acres_rule: 2, rows: [["X1", "2026-01-05", 400000, 40, 1, "4", "Sale", "010804401003002008", "", "NW SW 32-12-6 40A", "32-12?-6?", 0]] };
  const h = F.saleDetailHTML(F.rowObjs(f)[0], f, []);
  assert.match(h, /Section 32, T12, R6 \(the legal leaves out north or south and east or west\)/);
});
