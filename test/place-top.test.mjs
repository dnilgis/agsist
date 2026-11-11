/* The answers at the top of Fast Facts, My place (components/place-top.js, drawn by components/here.js),
 * Nov 11, 2026. Frozen fixtures only: no live data file, no clock.
 *
 *   node --test test/place-top.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/place.js");
const T = require(ROOT + "components/place-top.js");
const BID_SNAP = { fetched: "2026-11-11T03:23:04Z", bids: [
  { crop: "corn", cashPrice: 3.87, basis: -0.6, lat: 45.6, lon: -91.9, facility: "A", delivery: "11/01/2026", deliveryStart: "2026-11-01" },
  { crop: "corn", cashPrice: 3.69, basis: -0.78, lat: 45.35, lon: -91.66, facility: "B", deliveryStart: "2026-11-01" },
  { crop: "soybeans", cashPrice: 11.51, basis: -0.9, lat: 45.5, lon: -91.7, facility: "C", deliveryStart: "2026-11-01" },
] };
const DROUGHT = { valid: "2026-11-03", prev: "2026-10-27", prev4: "2026-10-06", source: "x",
  c: { "55005": [[100, 100, 17.1, 0, 0], [100, 100, 100, 0, 0], [100, 100, 100, 0, 0]], "55001": [[60, 20, 0, 0, 0], [60, 20, 0, 0, 0], [0, 0, 0, 0, 0]], "55003": [[40, 0, 0, 0, 0], [10, 0, 0, 0, 0], [0, 0, 0, 0, 0]] }, zero: ["55007"] };

test("top: the first card is the best corn bid when there is one; the state spot sits under the first answer; a missing card is left out", () => {
  const b = P.bestBids(BID_SNAP, 45.31, -91.65, 50), bid = T.bid(b, BID_SNAP.fetched, false);
  assert.equal(bid.price, "$3.87"); assert.equal(bid.delivery, "November delivery"); assert.equal(bid.posted, "Nov 11");
  assert.equal(bid.soy.price, "$11.51");
  assert.deepEqual(T.order({ bid, rain: {}, rent: {}, land: {} }), ["bid", "spot", "rain", "rent", "land"]);
  assert.deepEqual(T.order({ bid, rain: null, rent: {}, land: null }), ["bid", "spot", "rent"]);
  assert.deepEqual(T.order({ bid: null, rain: {}, rent: {} }), ["rain", "spot", "rent"], "no bid: the spot still follows the first answer");
  assert.deepEqual(T.order({}), ["spot"]);
  assert.equal(T.bid(P.bestBids({ bids: [] }, 45.31, -91.65, 50), "", false), null, "no bid: no card, never a did-not-answer line");
  assert.equal(T.bid({}, "", true), null);
});

test("top and the rows below agree: the bid is the same price from the same list, the drought line is the same words", () => {
  const b = P.bestBids(BID_SNAP, 45.31, -91.65, 50);
  const row = P.factBid(b.corn, "corn", "ZIP 54728", BID_SNAP.fetched, "/cash-bids?zip=54728", false), top = T.bid(b, BID_SNAP.fetched, false);
  assert.equal(top.price, row.value);
  assert.equal(top.soy.price, P.factBid(b.soybeans, "soybeans", "ZIP 54728", BID_SNAP.fetched, "", false).value);
  assert.match(row.ctx, new RegExp("^" + top.mi + " mi from"));
  const short = T.bid(b, BID_SNAP.fetched, true);
  assert.equal(short.partial, true); assert.equal(short.price, P.factBid(b.corn, "corn", "x", BID_SNAP.fetched, "", true).value);
  for (const f of ["55005", "55001", "55003", "55007"]) {
    const t = T.drought(DROUGHT, f), r = T.droughtRow(t);
    assert.equal(r.value + " " + r.ctx, t.line, f);
    assert.doesNotMatch(t.line, /\bD\d\b/, "no D-codes: " + t.line);
  }
  assert.equal(T.drought(DROUGHT, "55005").line, "Moderate drought across the whole county, better than last week.");
  assert.equal(T.drought(DROUGHT, "55001").line, "Moderate drought in 20% of the county, same as last week.", "any drought outranks a wider dry area");
  assert.equal(T.drought(DROUGHT, "55003").line, "Abnormally dry in 40% of the county, worse than last week.");
  assert.equal(T.drought(DROUGHT, "55007").line, "No drought or dry areas in the county, same as last week.");
  assert.equal(T.drought(DROUGHT, "99999"), null);
  assert.equal(T.drought(null, "55005"), null);
  const here = readFileSync(ROOT + "components/here.js", "utf8");
  assert.match(here, /S\.top\.drought = t;\n\s+fill\('f-drought', \(t && PT\.droughtRow\(t\)\)/, "one drought object feeds the row and the top line");
  assert.match(here, /fill\('f-corn-bid', P\.factBid\(b\.corn[^\n]+\n[^\n]+\n\s+\/\*[^\n]+\*\/\n\s+S\.top\.bid = PT \? PT\.bid\(b, when, partial\)/, "the top bid comes from the same list as the row");
});

test("top: rain this month against normal, since Jan 1, plain words; rent with its rank; farmland sales median", () => {
  const r = { status: "ok", inches: 31.5, normal: 31.24, pct: 101, through: "2026-11-09", normals: "1991-2020", month: { i: 10, inches: 1.93, usual: 0.64, days: 9 }, station: { name: "Cumberland", mi: 11.3 } };
  const t = T.rain(r);
  assert.equal(t.words, "3 times normal"); assert.equal(t.yearWords, "right at normal"); assert.equal(t.month, "November"); assert.equal(t.mi, 11);
  assert.equal(T.against(1, 1.05), "about normal"); assert.equal(T.against(0.5, 1), "50% of normal"); assert.equal(T.against(1.5, 1), "150% of normal"); assert.equal(T.against(1, 0), null);
  assert.equal(T.rain({ ...r, month: null }), null); assert.equal(T.rain({ status: "none" }), null);
  assert.equal(T.rain({ ...r, pct: 80 }).yearWords, "80% of normal");
  const col = { value: 103, year: 2026, pos: 0.246, words: "17th lowest of 68 Wisconsin counties, tied with 1 other" };
  assert.deepEqual(T.rent(col, "Wisconsin", 2026), { id: "rent", value: "$103", year: 2026, rank: "Lower than most of Wisconsin: 17th lowest of 68 counties, tied with 1 other." });
  assert.equal(T.rent({ ...col, year: 2021 }, "Wisconsin", 2026), null, "a survey over three years old is left out");
  assert.equal(T.rent({ value: null }, "Wisconsin", 2026), null);
  const A = { money: (x) => "$" + Math.round(x).toLocaleString("en-US"), span: (w) => w.join(" to "), thru: () => "Sep 30, 2026" };
  const sum = { min_acres: 20, windows: { cur: ["Oct 2025", "Sep 2026"] }, counties: { "55005": { med: { med: 5668, n: 22 } }, "55001": { k12: 2 } } };
  assert.deepEqual(T.land(sum, "55005", A), { id: "land", price: "$5,668", n: 22, acres: 20, span: "Oct 2025 to Sep 2026", thru: "Sep 30, 2026" });
  assert.equal(T.land(sum, "55001", A), null, "under the sale minimum: no card");
  for (const f of ["components/place-top.js"]) assert.doesNotMatch(readFileSync(ROOT + f, "utf8"), /—/);
});
