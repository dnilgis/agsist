/* components/place.js and data/atlas/pct (the numbers behind /here), Oct 18, 2026.
 *
 *   node --test test/place.test.mjs
 *
 * Ranks are among the state's counties with the figure, ties shared; a figure from another year
 * is not ranked; missing figures carry a reason; the one sentence is the fixed template; the pct
 * files are small and match their builder; this week's readers on real site files. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/place.js");
const L = require(ROOT + "components/layers.js");
const J = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const reg = L.load(readFileSync(ROOT + "data/layers.json", "utf8"));

test("pct files: one per state plus the index, small, and they match the builder", () => {
  const files = readdirSync(ROOT + "data/atlas/pct");
  assert.equal(files.filter((f) => /^[A-Z]{2}\.json$/.test(f)).length, 50);
  assert.ok(files.includes("index.json"));
  for (const f of files) {
    const b = readFileSync(ROOT + "data/atlas/pct/" + f);
    assert.ok(gzipSync(b).length < 30 * 1024, f + " gzip under 30 KB");
  }
  execFileSync("python3", [ROOT + "scripts/build_place_pct.py", "--check"], { stdio: "pipe" });
  execFileSync("python3", [ROOT + "scripts/build_place_pct.py", "--selftest"], { stdio: "pipe" });
});

test("every metric names a real registry layer and every county row has one value per metric", () => {
  for (const f of readdirSync(ROOT + "data/atlas/pct").filter((x) => /^[A-Z]{2}\.json$/.test(x))) {
    const d = J("data/atlas/pct/" + f);
    assert.equal(d.schema, "agsist-place-pct/1");
    for (const m of d.metrics) assert.ok(reg.byId[m.layer], f + " " + m.layer);
    for (const [fips, c] of Object.entries(d.counties)) {
      assert.equal(c.v.length, d.metrics.length, fips);
      assert.equal(P.stateOf(fips), d.state, fips);
      c.v.forEach((v, i) => { if (v == null) assert.ok(c.w && c.w[String(i)], fips + " metric " + i + " missing without a reason"); });
    }
  }
});

test("ranks: rank 1 is the highest; ties share the middle; lowest-half words count from the bottom", () => {
  const pct = { state: "ZZ", name: "Test", metrics: [{ id: "rent", layer: "rent", label: "Cash rent", short: "Rent", unit: "$/ac", dp: 0, years: "x", n: 6 }],
    counties: { a: { n: "A", v: [10] }, b: { n: "B", v: [20] }, c: { n: "C", v: [20] }, d: { n: "D", v: [30] }, e: { n: "E", v: [40] }, f: { n: "F", v: [null], w: { 0: "withheld" } } } };
  assert.deepEqual(P.rankIn(pct, "e", 0), { rank: 1, n: 5, tied: 0, pos: 1 });
  assert.deepEqual(P.rankIn(pct, "a", 0), { rank: 5, n: 5, tied: 0, pos: 0 });
  const b = P.rankIn(pct, "b", 0);
  assert.equal(b.rank, 3); assert.equal(b.tied, 1); assert.equal(b.pos, 0.375);
  assert.equal(P.rankIn(pct, "f", 0), null);
  const p = P.profile(pct, "a", null);
  assert.equal(p.cols[0].words, "lowest of 5 Test counties");
  assert.equal(P.profile(pct, "e", null).cols[0].words, "highest of 5 Test counties");
  assert.equal(P.profile(pct, "b", null).cols[0].words, "2nd lowest of 5 Test counties, tied with 1 other");
  assert.equal(P.profile(pct, "f", null).cols[0].reason, "withheld");
  // fewer than 5 counties: no rank
  const small = { ...pct, counties: { a: pct.counties.a, b: pct.counties.b } };
  assert.equal(P.profile(small, "a", null).cols[0].rank, null);
});

test("Barron County, WI: the sentence is the template, ranks are among Wisconsin counties", () => {
  const p = P.profile(J("data/atlas/pct/WI.json"), "55005", reg);
  assert.equal(p.name, "Barron County");
  // Oct 21 panel: the rent says which rent it is; the insurance figure has one name everywhere; "among the lowest tenth"
  assert.match(p.sentence, /^Barron County, WI: cash rent \$\d+ an acre for non-irrigated cropland in 20\d\d, \d+(st|nd|rd|th) (highest|lowest) of \d+ Wisconsin counties/);
  assert.doesNotMatch(p.sentence, /loss ratio|bottom tenth|top tenth/);
  if (/insurance/.test(p.sentence)) assert.match(p.sentence, /paid out \$\d\.\d\d per \$1 of total premium \(farmer and federal shares\)/);
  assert.match(p.sentence, /among the (lowest|highest) tenth of Wisconsin counties/);
  assert.doesNotMatch(p.sentence, /—|field/);
  for (const c of p.cols) {
    if (c.value == null) assert.ok(c.reason, c.id);
    else if (c.rank != null) assert.match(c.words, /Wisconsin counties/);
    assert.ok(c.source && c.years, c.id + " has a source and years");
  }
  const rent = p.cols.find((c) => c.id === "rent");
  const raw = J("data/atlas/counties/55005.json").rent.nonirr;
  assert.equal(rent.value, raw.value);
  assert.equal(rent.year, raw.year);
});

test("a figure from another year than most of the state keeps its number but is not ranked", () => {
  let seen = 0;
  for (const f of readdirSync(ROOT + "data/atlas/pct").filter((x) => /^[A-Z]{2}\.json$/.test(x))) {
    const d = J("data/atlas/pct/" + f);
    for (const [fips, c] of Object.entries(d.counties)) {
      if (!c.o || !c.o["0"]) continue;
      seen++;
      assert.equal(c.v[0], null);
      assert.notEqual(c.o["0"][1], d.metrics[0].year);
      assert.match(c.w["0"], /not ranked/);
      const p = P.profile(d, fips, reg);
      assert.equal(p.cols[0].rank, null);
      assert.equal(p.cols[0].other.value, c.o["0"][0]);
    }
  }
  assert.ok(seen > 50, "older rent figures exist: " + seen);
});

test("sentence with nothing to say, and with unusual neighbors", () => {
  const pct = { state: "ZZ", name: "Test", metrics: [{ id: "rent", layer: "rent", label: "Cash rent", short: "Rent", unit: "$/ac", dp: 0, years: "x" }], counties: { a: { n: "Empty County", v: [null], w: { 0: "withheld: x" } } } };
  assert.match(P.profile(pct, "a", null).sentence, /^Empty County, ZZ: the public records we read carry no county figures here/);
  const champ = P.profile(J("data/atlas/pct/IL.json"), "17019", reg);
  assert.ok(champ.unusual.length >= 1 && champ.unusual.length <= 3);
  for (const u of champ.unusual) { assert.ok(u.nbN >= 3); assert.ok(["higher", "lower", "same"].includes(u.dir)); }
});

test("query parsing and the box", () => {
  // &for= was the role chip (removed Oct 19): an old link still parses, the param is dropped
  assert.deepEqual(P.parseQuery("?zip=54728&for=farmer"), { q: "", fips: null, zip: "54728", at: null, print: null });
  assert.deepEqual(P.parseQuery("?fips=17019&at=40.1,-88.2&q=Champaign%2C%20IL").at, { lat: 40.1, lng: -88.2 });
  assert.equal(P.parseQuery("?fips=99001").fips, null, "no state 99");
  assert.deepEqual(P.parseQuery("?zip=54728&print=week,long,more").print, { parts: ["week", "long"], more: true, rain: false });
  assert.deepEqual(P.parseQuery("?zip=54728&print=rain").print, { parts: P.PRINT_PARTS, more: false, rain: true });
  assert.equal(P.parseQuery("?at=0,0").at, null);
  assert.equal(P.parsePoint("45.3, 91.6").lng, -91.6, "a longitude typed without its minus sign");
  assert.deepEqual(P.classify("54728"), { kind: "zip", zip: "54728" });
  assert.deepEqual(P.classify("Champaign County, IL"), { kind: "county", name: "Champaign County", st: "IL" });
  assert.deepEqual(P.classify("Great Bend, Kansas"), { kind: "town", name: "Great Bend", st: "KS" });
  assert.deepEqual(P.classify("chetek wi"), { kind: "town", name: "chetek", st: "WI" });
  assert.equal(P.classify("45.3,-91.6").kind, "point");
  assert.equal(P.classify("  ").kind, "empty");
});

test("county names: index lookup, a name in two states, a geocoder county in the state file", () => {
  const idx = J("data/atlas/pct/index.json");
  assert.deepEqual(P.findCounty(idx, "Champaign County", "IL").map((r) => r.fips), ["17019"]);
  assert.deepEqual(P.findCounty(idx, "champaign", null).map((r) => r.fips).sort(), ["17019", "39021"]);
  assert.deepEqual(P.findCounty(idx, "St. Louis County", "MN").map((r) => r.fips), ["27137"]);
  assert.equal(P.countyInState(J("data/atlas/pct/WI.json"), "Barron"), "55005");
  assert.equal(P.countyInState(J("data/atlas/pct/KS.json"), "Barton County"), "20009");
});

test("point in county on the site's county lines", () => {
  const geo = J("data/atlas/counties.geo.json");
  assert.equal(P.countyAt(geo, 45.314, -91.651), "55005", "Chetek");
  assert.equal(P.countyAt(geo, 40.116, -88.243), "17019", "Champaign");
  assert.equal(P.countyAt(geo, 38.364, -98.765), "20009", "Great Bend");
  assert.equal(P.countyAt(geo, 30, -40), null, "the Atlantic");
});

test("no roles: one go deeper row for everyone, built from what the place supports", () => {
  assert.equal(P.ROLES, undefined);
  assert.equal(P.order, undefined);
  assert.equal(P.tool, undefined);
  const place = { fips: "55005", st: "WI", slug: "barron-county", flags: "arpc", lat: 45.314, lng: -91.651, zip: "54728", sales: true };
  const row = P.deeper(place), href = Object.fromEntries(row.map((l) => [l.id, l.href]));
  // Oct 21 (tone): no "Data downloads" in a place's own links; the raw sets stay on /developer
  assert.deepEqual(row.map((l) => l.id), ["scout", "comps", "bids", "hail", "sheet", "atlas", "arcplc", "prf", "rain", "rent"]);
  for (const l of row) assert.ok(/^\//.test(l.href) && l.text && !/—/.test(l.text), l.id);
  assert.equal(href.scout, "/field-scout?at=45.3140,-91.6510&fips=55005");
  assert.equal(href.comps, "/comp-report?lat=45.3140&lon=-91.6510&at=town&fips=55005");
  assert.equal(href.bids, "/cash-bids?zip=54728");
  assert.equal(href.hail, "/hail-map?lat=45.3140&lon=-91.6510");
  assert.equal(href.sheet, "/farmland-atlas/sheet#55005");
  assert.equal(href.atlas, "/farmland-atlas/wisconsin/barron-county");
  assert.equal(href.arcplc, "/arc-plc/wisconsin/barron-county");
  assert.equal(href.prf, "/prf/wisconsin/barron-county");
  assert.equal(href.rain, "/rain/wisconsin/barron-county");
  // no recorded sales in the state, no county pages, no ZIP: those links drop, the rest stay
  const bare = P.deeper({ ...place, st: "KS", fips: "20009", slug: "barton-county", flags: "", zip: null, sales: false });
  assert.deepEqual(bare.map((l) => l.id), ["scout", "bids", "hail", "sheet", "rent"]);
  assert.equal(bare.find((l) => l.id === "bids").href, "/cash-bids/kansas/");
  assert.deepEqual(P.deeper(null), []);
});

test("print choices: the link form round-trips, defaults stay out of the link", () => {
  assert.deepEqual(P.PRINT_PARTS, ["sentence", "week", "fingerprint", "unusual", "long", "sources"]);
  assert.deepEqual(P.parsePrint(""), { parts: P.PRINT_PARTS, more: false, rain: false });
  assert.deepEqual(P.parsePrint("nonsense"), { parts: P.PRINT_PARTS, more: false, rain: false });
  assert.deepEqual(P.parsePrint("more"), { parts: P.PRINT_PARTS, more: true, rain: false });
  assert.deepEqual(P.parsePrint("long,week,week"), { parts: ["week", "long"], more: false, rain: false });
  // the year's rain drawn is off unless chosen (lender, Oct 21), and rides in the link like the rest
  assert.equal(P.printParam({ parts: P.PRINT_PARTS, more: false, rain: true }), "rain");
  assert.equal(P.printParam({ parts: ["week"], more: true, rain: true }), "week,more,rain");
  assert.equal(P.printParam({ parts: P.PRINT_PARTS, more: false }), "");
  assert.equal(P.printParam({ parts: P.PRINT_PARTS, more: true }), "more");
  assert.equal(P.printParam({ parts: ["long", "week"], more: true }), "week,long,more");
  for (const v of ["week", "fingerprint,more", "sentence,sources", "week,rain"]) assert.equal(P.printParam(P.parsePrint(v)), v);
});

test("the printed QR: shortest link that reopens the same report, smallest symbol, pinned", () => {
  globalThis.window = globalThis.window || globalThis;
  require(ROOT + "components/qr.js");
  const Q = globalThis.AgQR;
  const chetek = P.qrLink({ fips: "55005", zip: "54728" });
  assert.equal(chetek, "HTTPS://AGSIST.COM/H/55005/54728", "the short path 404.html routes back (Oct 19: smallest QR)");
  assert.equal(P.qrLink({ fips: "17019" }), "HTTPS://AGSIST.COM/H/17019");
  assert.equal(P.qrLink({ fips: "55005", at: { lat: 45.31413, lng: -91.651 } }), "HTTPS://AGSIST.COM/here?f=55005&a=45.3141,-91.6510");
  assert.equal(P.qrLink({ fips: "55005", zip: "54728", print: { parts: ["week"], more: true } }), "HTTPS://AGSIST.COM/here?f=55005&z=54728&p=66");
  // no tracking, no label, nothing but the place and the print choice
  assert.doesNotMatch(P.qrLink({ fips: "55005", zip: "54728", q: "Chetek, WI" }), /utm|q=|for=/);
  // the short keys reopen the same report
  const back = P.parseQuery("?f=55005&z=54728&p=66");
  assert.deepEqual([back.fips, back.zip, back.print], ["55005", "54728", { parts: ["week"], more: true, rain: false }]);
  assert.deepEqual(P.parseQuery("?f=55005&z=54728&p=191").print, { parts: P.PRINT_PARTS, more: false, rain: true });
  assert.deepEqual(P.parseQuery("?f=55005&a=45.3141,-91.6510").at, { lat: 45.3141, lng: -91.651 });
  for (let n = 1; n < 256; n++) { const c = P.printFromCode(n); if (n & 63) assert.equal(P.printCode(c), n); }
  // module counts at level M, the mode here.js draws with (mixed: letters-and-digits runs packed tight):
  // version 2 (25 x 25) for a ZIP or a county (was 29 in byte mode), 29 with a print choice, 33 with a point
  const M = (u) => Q.matrix(u, null, "mixed", 10).length;
  assert.equal(M(chetek), 25);
  assert.equal(M(P.qrLink({ fips: "17019" })), 25);
  assert.equal(M(P.qrLink({ fips: "55005", zip: "54728", print: { parts: ["week"], more: true } })), 29);
  assert.equal(M(P.qrLink({ fips: "55005", at: { lat: 45.31413, lng: -91.651 } })), 33);
  // the short paths go back to the same page through 404.html
  const RL = require(ROOT + "components/report-link.js");
  // (Oct 21: they open Fast Facts, where the place page moved; a /here link still shortens the same)
  assert.equal(RL.full("/H/55005/54728"), "https://agsist.com/fast-facts?f=55005&z=54728");
  assert.equal(RL.full("/h/17019"), "https://agsist.com/fast-facts?f=17019");
  assert.equal(RL.short("https://agsist.com/here?f=17019"), "HTTPS://AGSIST.COM/H/17019");
  assert.equal(RL.short("https://agsist.com/fast-facts?f=17019"), "HTTPS://AGSIST.COM/H/17019");
});

test("this week on the site's own files", () => {
  const r = P.rainSoFar(J("data/rain/wi.json"), "55005");
  assert.equal(r.status, "ok"); assert.ok(r.inches > 0 && r.normal > 0); assert.match(r.through, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(P.rainSoFar(null, "55005").status, "missing");
  const d = P.droughtNow(J("data/drought/county-week.json"), "55005");
  assert.equal(d.status, "ok"); assert.equal(d.now.length, 5);
  assert.equal(P.droughtNow({ c: {}, zero: ["02013"] }, "02013").worst, -1);
  const h = P.hailNear({ generated: "2026-10-18", days: 30, reports: [{ lat: 45.3, lon: -91.6, mag: 1.25, date: "2026-10-01", city: "X", st: "WI" }, { lat: 40, lon: -100, mag: 2, date: "2026-10-02", city: "Y", st: "KS" }] }, 45.31, -91.65);
  assert.equal(h.n, 1); assert.equal(h.biggest, 1.25);
  const b = P.basisVsNormal(J("data/transport/basis.json"), "KS", "Corn");
  assert.equal(b.status, "ok"); assert.ok(typeof b.delta === "number");
  assert.equal(P.basisVsNormal(J("data/transport/basis.json"), "WI", "Corn").status, "none");
  const held = { series: { "Corn|Kansas|Elevator Bid": { latest: -0.3, date: "2026-10-02", avg5: 0.1, delta: -0.4 } }, weeks: { "Corn|Elevator Bid": { week: "2026-10-09" } } };
  assert.match(P.basisVsNormal(held, "KS", "Corn").why, /last posted Kansas for the week of 2026-10-02/);
  assert.equal(P.stateBasis(J("data/basis-states.json"), "WI", "corn").status, "ok");
  const next = P.nextReport(readFileSync(ROOT + "usda-calendar.ics", "utf8"), new Date("2026-10-18T23:00:00Z"));
  assert.ok(next && next.at > new Date("2026-10-18T23:00:00Z"));
  assert.doesNotMatch(next.name, /CONAB|StatCan/);
});

test("best bids: verified only, inside the radius, a far-off basis never counts as best", () => {
  const row = (price, basis, lat, extra = {}) => ({ crop: "corn", cashPrice: price, basis, lat, lon: -91.65, facility: "E" + price, ...extra });
  const snap = { bids: [row(4.1, -0.6, 45.4), row(4.12, -0.58, 45.5), row(4.05, -0.65, 45.6), row(4.08, -0.62, 45.45), row(4.11, -0.59, 45.35), row(5.5, 0.8, 45.32), row(9, -0.6, 45.33, { verified: false }), row(4.5, -0.2, 47.5)] };
  const b = P.bestBids(snap, 45.31, -91.65, 50).corn;
  assert.equal(b.best.price, 4.12);
  assert.equal(b.left_out, 1);
  assert.equal(b.n, 6, "the unverified row and the one 150 miles away are not counted");
  assert.equal(b.nearest.facility, "E4.11");
});

test("long view rows come from the county's own file, with the partial year named", () => {
  const rows = P.longView(J("data/atlas/counties/55005.json"));
  assert.deepEqual(rows.map((r) => r.id), ["yield", "rent", "drought", "loss"]);
  const dr = rows.find((r) => r.id === "drought");
  assert.equal(dr.partial, J("data/atlas/counties/55005.json").drought.partial_year.year);
  assert.ok(!rows.find((r) => r.id === "loss").pts.some((p) => p[0] === 2026), "a partial insurance year is left out");
  assert.deepEqual(P.longView(null), []);
});
