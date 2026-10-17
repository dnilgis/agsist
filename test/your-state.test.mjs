/* The "Your area" box on /usda-calendar, /conditions-yield, /tariffs,
 * /cattle-futures-prices, /farm-bill, /crop-tour and /pod-counts:
 * components/your-state.js (core) and components/ys-<mode>.js (each page's lines).
 *
 *   node --test test/your-state.test.mjs
 *
 * Every number below is worked by hand in the comment beside it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readPage, buildIcs } from "../scripts/build_usda_ics.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const MODES = ["calendar", "cy", "tariffs", "cattle", "farmbill", "tour", "pods"];
const Y = require(ROOT + "components/your-state.js");
for (const m of MODES) require(ROOT + "components/ys-" + m + ".js");
const YA = require(ROOT + "components/your-area.js");
const CA = require(ROOT + "components/cattle-auction.js");
const NOW = Date.parse("2026-10-17T15:00:00Z");
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&middot;|&rarr;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const store = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
const run = (mode, loc, d, extra = {}) => Y.build({ loc, mode, d, now: NOW, tz: "America/Chicago", ...extra });
const place = (o) => ({ state: "", zip: "", county: "", lat: null, lon: null, ...o });
const json = (f) => JSON.parse(readFileSync(ROOT + f, "utf8"));

const stats = { stateStats: {
  IA: { name: "Iowa", year: 2026, forecast: true, forecast_month: "October", nass_load_time: "2026-10-09 12:00:00.000",
    corn_yield: 219.0, corn_prod: 2803, corn_acres_planted: 13.2, bean_yield: 63.0, bean_prod: 613, bean_acres_planted: 9.8, wheat_prod: null },
  WI: { name: "Wisconsin", year: 2026, forecast: true, forecast_month: "October", nass_load_time: "2026-10-09 12:00:00.000",
    corn_yield: 182.0, corn_prod: 564, corn_acres_planted: 4.0, bean_yield: 54.0, bean_prod: 120, bean_acres_planted: 2.2, wheat_prod: 16 } } };
const cornY = { rows: [{ state: "Iowa", values: { 2022: 200, 2023: 201, 2024: 211, 2025: 210 } }, { state: "Wisconsin", values: { 2025: 188 } }] };
const soyY = { rows: [{ state: "Iowa", values: { 2022: 58.5, 2023: 58, 2024: 60, 2025: 63.5 } }, { state: "Wisconsin", values: { 2025: 56 } }] };
const IA = place({ state: "IA", zip: "50010" });
const WI = place({ state: "WI", zip: "54728", county: "Barron County", lat: 45.4, lon: -91.8 });

test("saved location is read, never invented", () => {
  assert.equal(Y.readPlace(store({})), null);
  assert.equal(Y.readPlace(store({ "agsist-wx-loc": "not json" })), null);
  assert.deepEqual(Y.readPlace(store({ "agsist-wx-loc": JSON.stringify({ lat: 45.4, lon: -91.8, zip: "54728", state: "WI", county: "Barron County" }) })), WI);
  assert.deepEqual(Y.readPlace(store({ agsist_zip: "50010" })), place({ zip: "50010" }));
  assert.equal(Y.readPlace(store({ "agsist-wx-loc": JSON.stringify({ state: "Wisconsin", county: "<b>x</b>" }) })), null);
  assert.equal(Y.readPlace(store({ "agsist-wx-loc": JSON.stringify({ state: "ZZ" }) })), null, "not a state");
  // the sale-barn page's saved state counts on the cattle page only
  const sb = store({ "agsist-salebarn": JSON.stringify({ state: "NE", zip: "" }) });
  assert.equal(Y.readPlace(sb, "cattle").state, "NE");
  assert.equal(Y.readPlace(sb, "tour"), null);
});

test("no location, or a ZIP with no state: one small link to the ZIP search, nothing else", () => {
  assert.match(Y.none(), /href="\/cash-bids"/);
  assert.equal(text(Y.none()), "See this for your area");
  for (const m of MODES) {
    assert.equal(run(m, null, {}), Y.none(), m);
    assert.equal(run(m, place({ zip: "50010" }), {}), Y.none(), m + ": no state is guessed from a ZIP");
  }
});

test("missing data files: no numbers, only plain lines", () => {
  for (const m of MODES) {
    const t = text(run(m, IA, {}, { reports: [] }));
    assert.match(t, /^Your area: Iowa/, m);
    assert.doesNotMatch(t, /\d+(\.\d+)?%|bu\/acre|\/cwt|million/, m + ": " + t);
  }
});

/* ---------- calendar ---------- */
const REPORTS = [
  { date: "2026-10-12", name: "Crop Progress", type: "croprog", time: "4:00 PM ET" },
  { date: "2026-10-19", name: "Crop Progress", type: "croprog", time: "4:00 PM ET" },
  { date: "2026-10-09", name: "Crop Production", type: "supply", time: "12:00 PM ET" },
  { date: "2026-11-10", name: "Crop Production", type: "supply", time: "12:00 PM ET" },
  { date: "2026-12-11", name: "2026 ARC/PLC signup deadline", type: "fsa", time: "All Day" },
  { date: "2026-11-02", name: "2027 ARC/PLC signup opens", type: "fsa", time: "All Day" },
];
const progress = { in_season: true, states: { WI: {
  corn_harvested: { date: "2026-10-11", pct: 16, avg5: 18 }, soybeans_harvested: { date: "2026-10-11", pct: 54, avg5: 47 } } } };

test("calendar: Eastern release times to the instant, daylight time applied", () => {
  // Mon Oct 19 2026, 4 p.m. EDT (UTC-4) = 20:00 UTC; Thu Dec 10, noon EST (UTC-5) = 17:00 UTC
  assert.equal(new Date(Y.etInstant("2026-10-19", "4:00 PM ET")).toISOString(), "2026-10-19T20:00:00.000Z");
  assert.equal(new Date(Y.etInstant("2026-12-10", "12:00 PM ET")).toISOString(), "2026-12-10T17:00:00.000Z");
  // 2026 DST ends Sun Nov 1: Mon Nov 2, 8:30 a.m. EST = 13:30 UTC
  assert.equal(new Date(Y.etInstant("2026-11-02", "8:30 AM ET")).toISOString(), "2026-11-02T13:30:00.000Z");
  assert.ok(Number.isNaN(Y.etInstant("2026-11-02", "All Day")));
  assert.equal(Y.yourTime("2026-10-19", "4:00 PM ET", "America/Chicago"), " (3:00 PM your time)");
  assert.equal(Y.yourTime("2026-10-19", "4:00 PM ET", "America/New_York"), "", "no second clock for an Eastern reader");
  assert.equal(Y.yourTime("2026-10-19", "4:00 PM ET", "America/Denver"), " (2:00 PM your time)");
});

test("calendar: the next reports that carry the reader's state, with its last numbers", () => {
  const h = run("calendar", WI, { "crop-progress": progress, "state-stats": stats }, { reports: REPORTS });
  const t = text(h);
  assert.match(t, /Crop Progress , Mon Oct 19, 4:00 PM ET \(3:00 PM your time\): Wisconsin’s harvest pace and crop ratings\. Last week, ending Oct 11: corn 16% harvested \(5-yr avg 18%\), soybeans 54% harvested \(5-yr avg 47%\)\./);
  assert.match(t, /Crop Production , Tue Nov 10, 12:00 PM ET \(11:00 AM your time\): USDA’s Wisconsin corn and soybean yields\. Last time, USDA’s October forecast for 2026 \(Wisconsin, Oct 9\): corn 182 bu\/acre, soybeans 54\./);
  assert.match(t, /2027 ARC\/PLC signup opens , Mon Nov 2, at your FSA county office/, "the next FSA date, not a later one");
  assert.match(h, /href="\/arc-plc\/wisconsin\/barron-county"/);
  assert.match(h, /data-chk="\/arc-plc\/wisconsin"/, "falls back to the state page when the county page is missing");
  assert.match(h, /href="\/usda-calendar-grain\.ics"/);
  assert.match(h, /href="\/usda-calendar-livestock\.ics"/);
  assert.match(t, /USDA NASS crop progress, week ending Oct 11/);
});

test("calendar: a report already out is not next; stale progress is withheld", () => {
  // Mon Oct 19 at 5 p.m. CT: that day's 4 p.m. ET Crop Progress is out
  const after = Y.build({ loc: WI, mode: "calendar", d: { "crop-progress": progress, "state-stats": stats }, now: Date.parse("2026-10-19T22:00:00Z"), tz: "America/Chicago",
    reports: REPORTS.concat([{ date: "2026-10-26", name: "Crop Progress", type: "croprog", time: "4:00 PM ET" }]) });
  assert.match(text(after), /Crop Progress , Mon Oct 26/);
  const late = Y.build({ loc: WI, mode: "calendar", d: { "crop-progress": progress, "state-stats": stats }, now: Date.parse("2026-11-09T15:00:00Z"), tz: "America/Chicago", reports: REPORTS.concat([{ date: "2026-11-09", name: "Crop Progress", type: "croprog", time: "4:00 PM ET" }]) });
  assert.doesNotMatch(text(late), /harvested/, "progress 29 days old");
});

test("calendar page: the box, the shared list, and the narrow calendar files are current", () => {
  const h = readFileSync(ROOT + "usda-calendar.html", "utf8");
  assert.ok(h.indexOf("window.AGSIST_REPORTS=REPORTS;") > h.indexOf("const REPORTS = ["));
  const page = readPage(h);
  for (const [set, file] of [["grain", "usda-calendar-grain.ics"], ["livestock", "usda-calendar-livestock.ics"]])
    assert.equal(readFileSync(ROOT + file, "utf8"), buildIcs(page, set), file + " is stale: node scripts/build_usda_ics.mjs");
  const grain = readFileSync(ROOT + "usda-calendar-grain.ics", "utf8"), live = readFileSync(ROOT + "usda-calendar-livestock.ics", "utf8");
  assert.match(grain, /SUMMARY:WASDE/); assert.match(grain, /SUMMARY:Crop Production/); assert.match(grain, /ARC\/PLC/);
  assert.doesNotMatch(grain, /Cattle on Feed|Milk Production|CONAB|Export Sales/);
  assert.match(live, /SUMMARY:Cattle on Feed/); assert.match(live, /SUMMARY:WASDE/);
  assert.doesNotMatch(live, /SUMMARY:Crop Production|ARC\/PLC|Grain Stocks/);
  assert.equal(readFileSync(ROOT + "usda-calendar.ics", "utf8"), buildIcs(page), "the full file is unchanged by the sets");
});

/* ---------- conditions-yield ---------- */
const fit = { crops: {
  corn: { states: { WI: { weeks: { 39: { r2: 0.483, n: 26 }, 40: { r2: 0.414, n: 22 } }, latest: { year: 2026, week: 41, ge: 58.0 } } } },
  soybeans: { states: { WI: { weeks: { 41: { r2: 0.72, n: 23 } }, latest: { year: 2026, week: 41, ge: 55.0 } } } } } };

test("conditions-yield: the state's USDA forecast and finals, its rating and what that week is worth", () => {
  const t = text(run("cy", WI, { "state-stats": stats, "cond-yield/fit": fit, "nass/corn-yield": cornY, "nass/soy-yield": soyY }));
  assert.match(t, /USDA’s October forecast for 2026 \(Wisconsin, Oct 9\): corn 182 bu\/acre, soybeans 54\. 2025 finals: corn 188, soybeans 56\./);
  // ISO week 41 of 2026 runs Mon Oct 5 to Sun Oct 11; no fit at week 41 for corn, so week 40: r2 0.414 -> 41%, "weak" (0.25 to 0.5)
  assert.match(t, /Corn : 58% good\/excellent, week ending Oct 11\. At week 40 \(the latest with enough years\) the Wisconsin rating has explained 41% of its final yield against trend \(weak, 22 years\)\./);
  assert.match(t, /Soybeans : 55% good\/excellent, week ending Oct 11\. At this week the Wisconsin rating has explained 72% of its final yield against trend \(strong, 23 years\)\./);
  assert.match(t, /Our nowcast above is national\. No state yield is printed from it/);
  const old = { crops: { corn: { states: { WI: { ...fit.crops.corn.states.WI, latest: { year: 2025, week: 41, ge: 60 } } } } } };
  assert.doesNotMatch(text(run("cy", WI, { "cond-yield/fit": old })), /good\/excellent/, "last year's rating is not this week's");
});

/* ---------- tariffs ---------- */
const wasde = { wasde_pdf: { date: "2026-10-09", crops: {
  soybeans: { marketing_year: "2026/27", month: "Oct", production: { value: 4562, unit: "mil bu" } },
  corn: { marketing_year: "2026/27", month: "Oct", production: { value: 16034, unit: "mil bu" } } } } };
const basis = { generated: "2026-10-16T22:28:03Z", states: { WI: { name: "Wisconsin", path: "/cash-bids/wisconsin/#basis", crops: {
  corn: { contract: "ZCZ26", label: "Dec '26", n: 46, median: -0.565, wow: 0 },
  soybeans: { contract: "ZSX26", label: "Nov '26", n: 32, median: -0.82, wow: -2 } } } } };

test("tariffs: the state's share of the US crop and its basis, no state export figure", () => {
  const t = text(run("tariffs", IA, { "state-stats": stats, wasde }));
  // 613 / 4,562 = 13.44%; 2,803 / 16,034 = 17.48%
  assert.match(t, /Soybeans : Iowa’s crop, 613 million bu, is 13\.4% of the 4,562 million bu US crop\./);
  assert.match(t, /Corn : Iowa’s crop, 2,803 million bu, is 17\.5% of the 16,034 million bu US crop\./);
  assert.match(t, /USDA does not publish exports by state, so no state export share is printed here\./);
  const w = text(run("tariffs", WI, { "state-stats": stats, wasde, "basis-states": basis }));
  assert.match(w, /Soybeans : Wisconsin’s crop, 120 million bu, is 2\.6% .*Basis 82¢ under Nov '26, 2¢ weaker on the week \(32 elevators\)\./);
  assert.match(w, /Basis 56½¢ under Dec '26, unchanged on the week \(46 elevators\)\./);
  // a forecast from a different month than the WASDE is not divided into it
  const sep = { stateStats: { IA: { ...stats.stateStats.IA, forecast_month: "September" } } };
  assert.doesNotMatch(text(run("tariffs", IA, { "state-stats": sep, wasde })), /%/);
  assert.doesNotMatch(text(Y.build({ loc: WI, mode: "tariffs", d: { "basis-states": basis }, now: Date.parse("2026-11-10T12:00:00Z") })), /Basis/, "basis over 10 days old");
});

test("tariffs: basis cents print the same way as the Your area box on /daily", () => {
  for (const c of [56.5, 0.25, 12, 3.75, 100.5]) assert.equal(Y.qc(c), YA.qc(c), String(c));
});

/* ---------- cattle ---------- */
const sale = (date, k800, k500) => ({ date, receipts: 900, classes: { "steers|1-2": { ...(k500 ? { 500: { head: 7, cwt: k500 } } : {}), ...(k800 ? { 800: { head: 23, cwt: k800 } } : {}) } } });
const auction = { barns: [
  { name: "Near Barn", town: "Near", state: "WI", lat: 45.0, lon: -91.8, sales: [sale("2026-10-14", 322.34, 405)] },
  { name: "Old Barn", town: "Old", state: "WI", lat: 45.1, lon: -91.8, sales: [sale("2026-09-20", 300, 400)] },
  { name: "Far Barn", town: "Far", state: "SD", lat: 43.5, lon: -96.7, sales: [sale("2026-10-12", 340, null)] },
] };
const prices = { quotes: { "feeders-nearby": { ticker: "GFV26.CME", contract: "Oct '26", close: 343.97501, close_date: "2026-10-16",
  settles: { "2026-10-14": 340.95001220703125, "2026-10-15": 343.375, "2026-10-16": 343.9750061035156 } } } };

test("cattle: nearest barns' latest sale, and 8-weights against the feeder settle of that same day", () => {
  // 0.4 degrees of latitude = 27.6 miles; the same function as /cattle-auction-prices
  const near = { lat: 45.0, lon: -91.8 };
  assert.ok(Math.abs(Y.miles(WI, near) - CA.miles(WI, near)) < 0.01);
  assert.equal(Math.round(Y.miles(WI, near)), 28);
  const t = text(run("cattle", WI, { "cattle-auction": auction, prices }));
  // 322.34 - 340.95 = -18.61
  assert.match(t, /Near, WI , 28 mi, sale Oct 14: 5-weight steers \$405\.00\/cwt \(7 head\), 8-weight steers \$322\.34\/cwt \(23 head\), Medium and Large 1-2\. 8-weights were \$18\.61 under Oct '26 feeder futures \(\$340\.95\) that day\./);
  assert.doesNotMatch(t, /Old, WI/, "a sale over three weeks old");
  assert.doesNotMatch(t, /Far, SD/, "over 250 miles while a closer barn has a sale");
  assert.match(t, /Feeder futures, Oct '26, settled \$343\.98 on Oct 16\./);
});

test("cattle: no barn close by says so and shows the closest; no same-day settle, no gap", () => {
  const far = { barns: [auction.barns[2]] };
  const t = text(run("cattle", WI, { "cattle-auction": far, prices }));
  assert.match(t, /No sale barn in the USDA reports we read is within 250 miles of you\. The closest: Far, SD , \d+ mi, sale Oct 12: 8-weight steers \$340\.00\/cwt/);
  assert.doesNotMatch(t, /under Oct|over Oct/, "Oct 12 has no settle on file");
  const st = text(run("cattle", place({ state: "WI" }), { "cattle-auction": auction, prices }));
  assert.match(st, /Near, WI , sale Oct 14/, "no saved spot: the saved state's barns, no miles");
  const stale = text(Y.build({ loc: WI, mode: "cattle", d: { "cattle-auction": auction, prices }, now: Date.parse("2026-10-30T12:00:00Z") }));
  assert.doesNotMatch(stale, /Feeder futures, Oct/, "board over 5 days old");
});

/* ---------- farm bill ---------- */
const arc = { updated: "2026-10-16", default_year: { until: "2026-12-11", then: 2027, before: 2026 }, params: { payment_acres_pct: 0.85 }, years: {
  2026: { crops: {
    corn: { statutory: 4.1, prior_statutory: 3.7, loan: 2.42, erp: { erp: 4.42 }, scen: { usda: 4.7, usda_date: "Oct 9, 2026" } },
    soybeans: { statutory: 10.0, prior_statutory: 8.4, loan: 6.82, erp: { erp: 10.71 }, scen: { usda: 12.0, usda_date: "Oct 9, 2026" } },
    wheat: { statutory: 6.35, prior_statutory: 5.5, loan: 3.72, erp: { erp: 6.35 }, scen: { usda: 6.3, usda_date: "Oct 9, 2026" } } } },
  2027: { crops: { corn: { statutory: 4.1, prior_statutory: 3.7, loan: 2.42, erp: { erp: 4.34 }, scen: { usda: 2.0, usda_date: "test" } } } } } };

test("farm bill: county ARC/PLC link, reference prices and the PLC rate at USDA's price", () => {
  const h = run("farmbill", WI, { "arc-plc": arc, "state-stats": stats }), t = text(h);
  assert.match(h, /href="\/arc-plc\/wisconsin\/barron-county"/);
  assert.match(t, /Barron County, Wisconsin\. Your base acres and PLC yield are on your FSA farm records; we do not have them\. ARC or PLC for Barron County/);
  assert.match(t, /we do not have them/);
  // corn: max(0, 4.42 - max(4.70, 2.42)) = 0
  assert.match(t, /Corn \(4\.0 million acres in Wisconsin, 2026\): 2026 PLC pays below \$4\.42 a bushel \(effective reference price; the 2025 law set \$4\.10, up from \$3\.70\)\. At USDA’s \$4\.70 price \(Oct 9, 2026\): no PLC payment\./);
  assert.match(t, /Soybeans \(2\.2 million acres in Wisconsin.*below \$10\.71 .*\$12\.00 .*no PLC payment\./);
  // wheat: 6.35 - max(6.30, 3.72) = 0.05 -> 5 cents
  assert.match(t, /Wheat : 2026 PLC pays below \$6\.35 .*5¢ a bushel of PLC yield on 85% of base acres\./);
  assert.doesNotMatch(text(run("farmbill", IA, { "arc-plc": arc, "state-stats": stats })), /Wheat/, "Iowa has no wheat on file");
  // after Dec 11 the 2027 year; the loan rate floors the price: 4.34 - max(2.00, 2.42) = 1.92
  const t27 = text(Y.build({ loc: IA, mode: "farmbill", d: { "arc-plc": arc }, now: Date.parse("2026-12-15T15:00:00Z") }));
  assert.match(t27, /2027 PLC pays below \$4\.34 .*: \$1\.92 a bushel of PLC yield/);
  assert.match(Y.h.countyLink(place({ county: "St. Croix County" }), "Wisconsin"), /\/arc-plc\/wisconsin\/st-croix-county"/);
});

/* ---------- crop tour and pod counts (real data/crop-tour.json) ---------- */
const tour = json("data/crop-tour.json");

test("crop tour: the state's sample first, then how it has run against USDA's final", () => {
  const t = text(run("tour", IA, { "crop-tour": tour, "state-stats": stats, "nass/corn-yield": cornY }));
  // 2022-25 tour samples 183.81, 182.80, 192.79, 198.43: mean 189.4575; NASS finals 200, 201, 211, 210
  // gaps -16.19, -18.20, -18.21, -11.57: mean -16.04
  assert.match(t, /Iowa on the 2026 tour \(Aug \d+\): corn sample 193\.98 bu\/acre, against 189\.46 on average for 2022-2025\./);
  assert.match(t, /Iowa’s tour sample ran 16\.0 bu under on average, 2022-2025 \(2022: -16\.2, 2023: -18\.2, 2024: -18\.2, 2025: -11\.6\)\./);
  assert.match(t, /USDA’s October forecast for 2026: 219 bu\/acre, \+25\.0 from the tour sample\./);
  const w = text(run("tour", WI, { "crop-tour": tour, "state-stats": stats }));
  assert.match(w, /The tour does not sample Wisconsin\. Its states: Ohio, South Dakota, Indiana, Nebraska, Illinois, Iowa, Minnesota\./);
});

test("pod counts: the state's row matches the page's own table, and USDA's forecast against the band", () => {
  const html = readFileSync(ROOT + "pod-counts.html", "utf8");
  const row = (n) => html.slice(html.indexOf("<tr><td>" + n + "</td>"), html.indexOf("</tr>", html.indexOf("<tr><td>" + n + "</td>")));
  const t = text(run("pods", IA, { "crop-tour": tour, "state-stats": stats, "nass/soy-yield": soyY }));
  // Iowa: 1,362.93 - 1,265.38 = +97.55 pods x 0.0227 = +2.21 bu, band -3.8 to +8.2
  assert.match(t, /Iowa : 2026 pod count 1,362\.93 against a 1,265\.38 average for 2022-2025 \(\+97\.5\)\. That is about \+2\.2 bu .*band -3\.8 to \+8\.2 \(AGSIST calibration, not a Pro Farmer number\)\./);
  assert.match(row("Iowa"), /1,362\.93[\s\S]*1,265\.38[\s\S]*\+97\.5[\s\S]*\+2\.2[\s\S]*-3\.8 to \+8\.2/, "same numbers as the page table");
  // NASS 2022-25: (58.5 + 58 + 60 + 63.5) / 4 = 60.0; 63 - 60 = +3.0, inside -3.8 to +8.2
  assert.match(t, /USDA’s October forecast for 2026: 63 bu\/acre, \+3\.0 against the 60\.0 NASS average for 2022-2025, inside the pod-count band\./);
  const mn = text(run("pods", place({ state: "MN" }), { "crop-tour": tour }));
  assert.match(mn, /\(\+165\.4\)\. That is about \+3\.8 bu .*band -2\.2 to \+9\.8/);
  assert.match(row("Minnesota"), /\+3\.8[\s\S]*-2\.2 to \+9\.8/);
  assert.match(text(run("pods", WI, { "crop-tour": tour, "state-stats": stats })), /The tour does not count pods in Wisconsin\..*soybeans 54 bu\/acre/);
  assert.doesNotMatch(text(run("pods", IA, { "crop-tour": tour, "state-stats": stats })), /NASS average/, "no finals file, no comparison");
});

/* ---------- files and pages ---------- */
test("components: no em dashes, small, read storage only", () => {
  const core = readFileSync(ROOT + "components/your-state.js", "utf8");
  assert.ok(gzipSync(core).length < 5120, "core gzip " + gzipSync(core).length);
  for (const f of ["your-state"].concat(MODES.map((m) => "ys-" + m))) {
    const s = readFileSync(ROOT + "components/" + f + ".js", "utf8");
    assert.doesNotMatch(s, /—|&mdash;/, f);
    assert.doesNotMatch(s, /setItem|sendBeacon|gtag\(|method:\s*'POST'|removeItem/, f);
    if (f !== "your-state") assert.ok(gzipSync(s).length < 2048, f + " gzip " + gzipSync(s).length);
  }
});

const PAGES = [
  ["usda-calendar.html", "calendar", '<section class="cal-hero'],
  ["conditions-yield.html", "cy", 'id="cy-nowcast"'],
  ["tariffs.html", "tariffs", 'id="tariff-table"'],
  ["cattle-futures-prices.html", "cattle", 'id="ct-cash"'],
  ["farm-bill.html", "farmbill", 'id="for-you"'],
  ["crop-tour.html", "tour", "<!-- /CT:hero -->"],
  ["pod-counts.html", "pods", 'class="pc-lede"'],
];
for (const [f, mode, after] of PAGES) {
  test(f + ": one box after the main answer, with its script", () => {
    const h = readFileSync(ROOT + f, "utf8");
    assert.equal((h.match(/data-your-state=/g) || []).length, 1);
    const at = h.indexOf('<aside class="ya" data-your-state="' + mode + '" data-v="1" hidden></aside>');
    assert.ok(at > 0, "box");
    assert.ok(at > h.indexOf(after), "after " + after);
    assert.match(h, /<script src="\/components\/your-state\.js\?v=\d+" defer><\/script>/);
  });
}
