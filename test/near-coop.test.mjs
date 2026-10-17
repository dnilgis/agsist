/* The "Your area" box on /fertilizer and /nutrient-removal
 * (components/near-coop.js, data/fert-coop-places.json).
 *
 *   node --test test/near-coop.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const N = require(ROOT + "components/near-coop.js");
const NR = require(ROOT + "components/nutrient-removal.js");
const SRC = readFileSync(ROOT + "components/near-coop.js", "utf8");
const read = (f) => readFileSync(ROOT + f, "utf8");
const NOW = Date.parse("2026-10-17T12:00:00Z");

/* Fixtures: two Kansas co-ops (one with a town point), one Wisconsin co-op
   with no town; Iowa and Kansas basis; Dec '26 corn. */
const coops = {
  summary: [{ key: "urea", name: "Urea" }, { key: "potash", name: "Potash" }, { key: "dap", name: "DAP" }, { key: "anhydrous", name: "Anhydrous ammonia" }],
  coops: [
    { id: "a-ks", name: "Alpha Coop", town: "McCune", state: "KS", cash_label: "5% cash discount", ok: true, rows: [
      { product: "dap", cash: 921.5, date: "2026-10-06", flags: [] },
      { product: "urea", cash: 608, date: "2026-10-06", flags: [] },
      { product: "potash", cash: 465.5, date: "2026-10-06", flags: [] },
      { product: "potash", cash: 999, date: "2026-10-06", flags: [] },
      { product: "thiosul", cash: 450, date: "2026-10-06", flags: [] },
      { product: "anhydrous", cash: 800, date: "2026-07-01", flags: [], stale: true } ] },
    { id: "b-ks", name: "Beta Coop", town: null, state: "KS", cash_label: "cash", ok: true, rows: [
      { product: "urea", cash: 630, date: "2026-10-01", flags: [] } ] },
    { id: "c-wi", name: "Gamma Cooperative", town: null, state: "WI", cash_label: "cash", ok: true, rows: [
      { product: "urea", cash: 610, date: "2026-10-01", flags: [] } ] },
  ],
};
const places = { coops: { "a-ks": { town: "McCune", state: "KS", lat: 37.3666, lng: -95.0174 } } };
const basis = { generated: "2026-10-17T00:37:10Z", states: {
  IA: { name: "Iowa", path: "/cash-bids/iowa/#basis", crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 277, median: -0.4 } } },
  KS: { name: "Kansas", path: "/cash-bids/kansas/#basis", crops: { corn: { contract: "ZCZ26", label: "Dec '26", n: 201, median: -0.35 } } },
  WI: { name: "Wisconsin", path: "/cash-bids/wisconsin/#basis", crops: { soybeans: { contract: "ZSX26", label: "Nov '26", n: 2 } } },
} };
const prices = { quotes: { "corn-dec26": { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-16" } } };
const list = { prices: [
  { key: "urea", name: "Urea", symbol: "46-0-0", price: 615.95, as_of: "2026-10-06", region: "Kansas and Wisconsin", short_label: "Kansas and Wisconsin co-ops, Sep 24 to Oct 6" },
  { key: "anhydrous", name: "Anhydrous ammonia", symbol: "82-0-0", price: 832.1, as_of: "2026-10-06", region: "Kansas", short_label: "Kansas co-ops, Sep 24 to Oct 6" },
  { key: "map", name: "MAP", symbol: "11-52-0", price: 980, as_of: "2026-10-12", region: "Kansas" },
  { key: "potash", name: "Potash", symbol: "0-0-60", price: 475.3, as_of: "2026-10-06", region: "Kansas" },
] };
const base = { coops, places, basis, prices, list, NR, now: NOW };
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&rarr;/g, "->").replace(/&middot;/g, "|").replace(/\s+/g, " ");
const IA = { state: "IA", zip: "50010", lat: 42.03, lon: -93.62 };
const KS = { state: "KS", zip: "66753", lat: 37.3666, lon: -95.2 };

test("ZIP to state from the first three digits", () => {
  const cases = { "54728": "WI", "50010": "IA", "66753": "KS", "60601": "IL", "55101": "MN", "68508": "NE", "57101": "SD", "58102": "ND",
    "46204": "IN", "43215": "OH", "48933": "MI", "63101": "MO", "73301": "TX", "73102": "OK", "88510": "TX", "20001": "DC", "20101": "VA",
    "05501": "MA", "00601": "", "09001": "", "99501": "AK", "96801": "HI", "83702": "ID", "12345": "NY", "abcde": "" };
  for (const [z, st] of Object.entries(cases)) assert.equal(N.zipState(z), st, z);
});

test("ZIP prefixes agree with every elevator on file that names its ZIP and state", () => {
  const d = JSON.parse(read("data/elevator-directory.json"));
  const bad = [];
  let n = 0;
  for (const e of d.elevators || []) {
    if (!/^\d{5}$/.test(e.zip || "") || !/^[A-Z]{2}$/.test(e.state || "")) continue;
    n++;
    if (N.zipState(e.zip) !== e.state) bad.push(`${e.zip} ${e.state} -> ${N.zipState(e.zip)}`);
  }
  assert.ok(n > 500, "enough elevators to check: " + n);
  assert.ok(bad.length <= n * 0.005, "ZIP prefixes off for: " + bad.slice(0, 20).join(", "));
});

test("location: wx-loc point and state, else a saved ZIP; nothing saved is null", () => {
  const ls = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
  assert.deepEqual(N.readLoc(ls({ "agsist-wx-loc": JSON.stringify({ lat: 42.03, lon: -93.6, zip: "50010", state: "IA" }) })), { state: "IA", zip: "50010", lat: 42.03, lon: -93.6 });
  assert.deepEqual(N.readLoc(ls({ agsist_zip: "54728" })), { state: "WI", zip: "54728", lat: null, lon: null });
  assert.deepEqual(N.readLoc(ls({ "agsist-wx-loc": JSON.stringify({ lat: 0, lon: 0 }) , agsist_zip: "66753" })), { state: "KS", zip: "66753", lat: null, lon: null });
  assert.equal(N.readLoc(ls({})), null);
  assert.equal(N.readLoc(ls({ agsist_zip: "5472" })), null);
  assert.match(N.none(), /href="\/cash-bids">See this for your area</);
});

test("co-op rows: one per product (the first), summarized products only, stale rows out, nearest first", () => {
  const c = N.coops(coops, places, KS);
  assert.equal(c[0].id, "a-ks");
  assert.deepEqual(c[0].rows.map((r) => r.key), ["dap", "urea", "potash"]);
  assert.equal(c[0].rows[2].cash, 465.5);
  assert.ok(c[0].mi > 9 && c[0].mi < 11, "McCune to -95.2 is about 10 miles: " + c[0].mi);
  assert.equal(c[1].mi, null);
  assert.equal(c[1].state, "KS", "no-distance co-ops in the reader's state come before others");
});

test("fertilizer box, Iowa: no co-op in Iowa, nearest named with miles, N:corn at Iowa basis (hand-worked)", () => {
  const t = text(N.buildFert({ ...base, loc: IA }));
  assert.match(t, /Your area: Iowa/);
  assert.match(t, /No co-op in Iowa posts prices we read yet\. The nearest we read is Alpha Coop, McCune, KS, about 330 miles away: a reference/);
  /* 832.10 / (20 x 82) = 0.5074 a lb N; 474.25 - 40 = 434.25c = $4.34;
     0.5074 / 4.3425 = 0.117; futures alone 0.5074 / 4.7425 = 0.107. */
  assert.match(t, /N:corn at Iowa basis: 0\.117/);
  assert.match(t, /is \$0\.51 a lb of N/);
  assert.match(t, /about \$4\.34 cash/);
  assert.match(t, /On futures alone the ratio is 0\.107; basis makes N dearer/);
  assert.match(t, /median of 277 AGSIST network elevators in Iowa, bids as of Oct 16/);
  assert.match(t, /Bids near 50010/);
  assert.match(t, /straight line/);
});

test("fertilizer box, Kansas: nearest co-op's own posted prices and date", () => {
  const t = text(N.buildFert({ ...base, loc: KS }));
  assert.match(t, /Nearest co-op we read: Alpha Coop, McCune, KS, about 10 miles\. DAP \$921\.50, Urea \$608, Potash \$465\.50 a ton, posted Oct 6 \(5% cash discount\)/);
  assert.match(t, /Also read in Kansas: Beta Coop \(town not posted\)/);
  assert.doesNotMatch(t, /Gamma/);
});

test("fertilizer box, ZIP only (no point): no miles printed, states named", () => {
  const t = text(N.buildFert({ ...base, loc: { state: "IA", zip: "50010", lat: null, lon: null } }));
  assert.match(t, /The co-ops we read are in Kansas and Wisconsin\./);
  assert.doesNotMatch(t, /miles/);
});

test("missing data stays missing: no basis, stale basis, wrong contract, no co-op file", () => {
  const noBasis = text(N.buildFert({ ...base, basis: null, loc: IA }));
  assert.doesNotMatch(noBasis, /N:corn/);
  const stale = text(N.buildFert({ ...base, basis: { ...basis, generated: "2026-09-30T00:00:00Z" }, loc: IA }));
  assert.doesNotMatch(stale, /N:corn/);
  const oldQuote = { quotes: { x: { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-01" } } };
  assert.doesNotMatch(text(N.buildFert({ ...base, prices: oldQuote, loc: IA })), /N:corn/);
  const empty = text(N.buildFert({ ...base, coops: null, basis: null, loc: IA }));
  assert.match(empty, /No co-op prices or state basis to show for your area right now\./);
  assert.doesNotMatch(empty, /\$\d/);
  const nrEmpty = text(N.buildNR({ ...base, coops: null, basis: null, loc: IA }));
  assert.match(nrEmpty, /No state basis or co-op price to show/);
});

test("nutrient removal box, Kansas: stalk ton in bushels and at the nearest co-op (hand-worked)", () => {
  const t = text(N.buildNR({ ...base, loc: KS }));
  /* Page prices: urea 615.95/920 = 0.6695 N; MAP (980 - 220 x 0.6695)/1040
     = 0.8007 P2O5; potash 475.30/1200 = 0.3961 K2O. Stalks 4.6 P + 32 K:
     3.683 + 12.675 = 16.36. Kansas cash 474.25 - 35 = $4.39: 3.7 bu. */
  assert.match(t, /A dry ton of stalks is about 3\.7 bushels of your corn\. Putting its P and K back costs \$16\.36/);
  /* Alpha: potash 465.50/1200 = 0.3879, x 32 = 12.41. DAP 921.50 less
     360 lb N at 608/920 (237.91) = 683.59 / 920 = 0.7430 x 4.6 = 3.42;
     12.41 + 3.42 = 15.83. */
  assert.match(t, /potash \$465\.50 a ton \(Oct 6\) is \$0\.39 a lb of K₂O, so a dry ton of stalks’ 32 lb is \$12\.41\./);
  assert.match(t, /the 4\.6 lb of P₂O₅ adds \$3\.42: \$15\.83 a dry ton there\./);
});

test("nutrient removal box, Iowa: a co-op 330 miles off is named, not priced as yours", () => {
  const t = text(N.buildNR({ ...base, loc: IA }));
  assert.match(t, /No co-op in Iowa posts a potash price we read yet; the nearest is Alpha Coop, McCune, KS, about 330 miles away\./);
  assert.doesNotMatch(t, /\$12\.41/);
});

test("pages: one box, the ZIP-search link without JS or location, the script only for a saved location", () => {
  for (const [f, mode] of [["fertilizer.html", "fert"], ["nutrient-removal.html", "nr"]]) {
    const s = read(f);
    assert.equal((s.match(/data-near-coop="/g) || []).length, 1, f);
    assert.match(s, new RegExp(`<aside class="nc-n" data-near-coop="${mode}" aria-label="Your area"><p><a href="/cash-bids">See this for your area</a></p></aside>`), f);
    const loader = s.match(/<script>\/\* near-coop:[^<]*<\/script>/);
    assert.ok(loader, f + " has the inline loader");
    assert.match(loader[0], /getItem\('agsist-wx-loc'\)\|\|localStorage\.getItem\('agsist_zip'\)/);
    assert.match(loader[0], /\/components\/near-coop\.js\?v=\d+/);
    assert.ok(gzipSync(loader[0] + s.match(/<aside class="nc-n"[^]*?<\/aside>/)[0]).length < 500, f + ": under half a KB added for every reader");
    assert.doesNotMatch(s, /<script src="\/components\/near-coop\.js/, f + ": never loaded for a reader with no location");
  }
  const n = read("nutrient-removal.html");
  assert.ok(n.indexOf("data-near-coop") < n.indexOf('id="calculator"'), "box above the calculator");
});

test("places file covers every co-op on the source list", () => {
  const src = JSON.parse(read("scripts/coop_fert_sources.json"));
  const pl = JSON.parse(read("data/fert-coop-places.json"));
  for (const c of src.coops) {
    const placed = !!pl.coops[c.id], un = pl.unplaced.includes(c.id);
    assert.ok(placed !== un, c.id + " is in exactly one of coops / unplaced");
    if (placed) {
      assert.equal(pl.coops[c.id].town, c.town, c.id);
      assert.equal(pl.coops[c.id].state, c.state, c.id);
    }
    if (!c.town) assert.ok(un, c.id + " has no town, so no point");
  }
});

test("small, plain, private", () => {
  const gz = gzipSync(SRC).length;
  assert.ok(gz < 6500, "near-coop.js gzip " + gz + " (loaded only for readers with a saved location)");
  assert.ok(Buffer.byteLength(read("data/fert-coop-places.json")) < 3000);
  assert.doesNotMatch(SRC, /—/, "no em dash");
  assert.doesNotMatch(SRC, /setItem|sendBeacon|XMLHttpRequest|gtag/, "reads only, sends nothing about the reader");
  for (const f of ["fertilizer.html", "nutrient-removal.html"]) assert.doesNotMatch(read(f).match(/data-near-coop[^>]*>/)[0], /—/);
});
