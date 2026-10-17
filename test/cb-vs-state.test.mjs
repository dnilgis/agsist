/* /cash-bids: "basis here vs your state" (components/cb-vs-state.js).
 *
 *   node --test test/cb-vs-state.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const V = require(ROOT + "components/cb-vs-state.js");
const NC = require(ROOT + "components/near-coop.js");
const read = (f) => readFileSync(ROOT + f, "utf8");
const NOW = Date.parse("2026-10-17T12:00:00Z");

const bs = { generated: "2026-10-17T00:37:10Z", states: {
  IA: { name: "Iowa", path: "/cash-bids/iowa/#basis", crops: {
    corn: { contract: "ZCZ26", label: "Dec '26", n: 277, median: -0.4 },
    soybeans: { contract: "ZSX26", label: "Nov '26", n: 237, median: -0.65 } } } } };
/* Elevators as cash-bids.js groups them; nearest() stands in for getNearestBid. */
const E = (b) => ({ corn: b[0], soybeans: b[1] });
const els = [
  E([{ basis: -0.38, symbol: "ZCZ26" }, { basis: -0.62, symbol: "ZSX26" }]),
  E([{ basis: -0.30, symbol: "ZCZ26" }, { basis: -0.70, symbol: "ZSX26" }]),
  E([{ basis: -0.45, symbol: "ZCZ26" }, null]),
  E([{ basis: -0.20, symbol: "ZCH27" }, { basis: -0.60, symbol: "ZSX26" }]),
  E([{ basis: 1.40, symbol: "ZCZ26", _odd: {} }, null]),
];
const o = { zip: "50010", nearest: (e, c) => e[c], cents: (b) => Math.round(b * 10000) / 100, contract: (b) => b.symbol, crop: "all", delivery: "all" };

test("hand-worked: corn middle of the 3 Dec bids, soybeans of the 3 Nov bids, against Iowa's middle", () => {
  const r = V.compute(els, o, bs, NOW);
  /* Corn: -38, -30, -45 on Dec (the Mar '27 bid and the unusual +140 are out):
     middle -38, Iowa -40 -> 2c stronger. Soybeans: -62, -70, -60: middle -62,
     Iowa -65 -> 3c stronger. */
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].n, r[0].search, r[0].state, r[0].diff], [3, -38, -40, 2]);
  assert.deepEqual([r[1].n, r[1].search, r[1].state, r[1].diff], [3, -62, -65, 3]);
  const t = V.html(r).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /Corn basis here vs Iowa: the middle of 3 elevators in this search is 38¢ under Dec '26, 2¢ stronger than the Iowa middle \(40¢ under, 277 elevators\)\./);
  assert.match(t, /Soybean basis here vs Iowa: the middle of 3 elevators in this search is 62¢ under Nov '26, 3¢ stronger than the Iowa middle \(65¢ under, 237 elevators\)\./);
  assert.match(t, /State middle as of Oct 16/);
});

test("no line when it cannot be like for like", () => {
  assert.deepEqual(V.compute(els.slice(0, 2), o, bs, NOW), [], "fewer than 3 elevators");
  assert.deepEqual(V.compute(els, { ...o, zip: "54728" }, bs, NOW), [], "state not in the file");
  assert.deepEqual(V.compute(els, { ...o, zip: "" }, bs, NOW), [], "no ZIP");
  assert.deepEqual(V.compute(els, { ...o, delivery: "2026-11" }, bs, NOW), [], "a month filter");
  assert.deepEqual(V.compute(els, o, { ...bs, generated: "2026-10-01T00:00:00Z" }, NOW), [], "state file over 10 days old");
  assert.deepEqual(V.compute(els, o, null, NOW), [], "no state file");
  assert.deepEqual(V.compute(els, { ...o, crop: "wheat" }, bs, NOW), [], "wheat picked");
  assert.equal(V.html([]), "");
  assert.equal(V.compute(els, { ...o, crop: "corn" }, bs, NOW).length, 1);
});

test("one ZIP-prefix table on the site: cash bids and the Your area box agree", () => {
  for (let p = 0; p < 1000; p++) {
    const z = String(p).padStart(3, "0") + "01";
    assert.equal(V.zipState(z), NC.zipState(z), z);
  }
});

test("wired into cash bids, small, plain", () => {
  const h = read("cash-bids.html"), js = read("components/cash-bids.js"), src = read("components/cb-vs-state.js");
  assert.match(h, /<p id="cb-vs-state" class="cb-vs" hidden><\/p>/);
  assert.match(h, /<script src="\/components\/cb-vs-state\.js\?v=\d+"><\/script>/);
  assert.ok(h.indexOf("cb-vs-state.js") < h.indexOf("<script src=\"/components/cash-bids.js"), "loads before cash-bids.js");
  assert.match(js, /CBVsState\.draw\(elevators,\{nearest:getNearestBid,cents:basisCents,contract:cbRank\.contractKey/);
  assert.ok(gzipSync(src).length < 3000, "gzip " + gzipSync(src).length);
  assert.doesNotMatch(src, /—/);
  assert.doesNotMatch(src, /localStorage|setItem|sendBeacon/);
});
