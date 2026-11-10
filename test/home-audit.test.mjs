/* Nov 10 home page fixes, each case from the real page.
 * The bid rows are frozen copies of the bids repo files (test/fixtures/home-audit/), read Nov 9 2026 23:49 UTC;
 * the clock inside the page is pinned to that week, so nothing here reads live data or today's date.
 *   node --test test/home-audit.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const FIX = "test/fixtures/home-audit/";
const fx = (f) => JSON.parse(read(FIX + f));
const FIXED = Date.UTC(2026, 10, 10, 12, 30); // pin-ok: the page's clock, set by the test

function load({ shards = true } = {}) {
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop,
    appendChild: noop, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] });
  const document = { readyState: "complete", getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: el, addEventListener: noop, head: el(), body: el(), documentElement: el() };
  const files = { "/data/prices.json": read(FIX + "prices.json"), "/data/harvest-prices.json": "{}" };
  const net = { shard: (p) => Promise.resolve(shards ? fx(p.replace(/^merged\//, "")) : null) };
  const window = { document, addEventListener: noop, removeEventListener: noop, dispatchEvent: noop, AGSIST_BIDS_NET: net,
    location: { search: "", hostname: "x", pathname: "/" }, navigator: {}, localStorage: { getItem: () => null, setItem: noop } };
  window.window = window;
  class FDate extends Date {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  }
  const fetch = (u) => {
    const k = String(u).split("?")[0];
    return k in files ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(files[k]), json: () => Promise.resolve(JSON.parse(files[k])) })
      : Promise.reject(new Error("offline"));
  };
  const ctx = vm.createContext({ window, document, navigator: {}, location: window.location, localStorage: window.localStorage,
    setTimeout, clearTimeout, console, Date: FDate, Intl, CustomEvent: function () {}, fetch, AbortController });
  window.fetch = fetch;
  vm.runInContext(read("components/util.js"), ctx);
  ctx.AG = window.AG;
  vm.runInContext(read("components/elev-names.js"), ctx); // index.html loads it before the card (normOperator reads window.elevNames)
  vm.runInContext(read("components/bids-homepage.js"), ctx);
  return window.__agsistHomeBidsInternals;
}

// a network row exactly as fromNetwork() builds it from the index place and its `now` pick
function rowsOf(placeName) {
  const p = fx("index-places.json").places.find((x) => x.place === placeName);
  assert.ok(p, placeName + " is in the fixture");
  return Object.keys(p.now).map((crop) => {
    const n = p.now[crop];
    return { facility: p.operator, branch: "", city: p.city, town: "", state: p.state, distance: 3, phone: "", commodity: n.commodity,
      cashPrice: n.cash, basis: n.basisCents / 100, deliveryMonth: "", delivery: n.delivery, checkedAt: p.checkedAt, pricedAt: p.pricedAt,
      netCrop: crop, place: p.place, sourceId: p.source, shard: p.shard, deliveryStart: n.period, category: crop, source: "network",
      currency: "USD", bestCash: null, bestPeriod: "", lat: p.lat, lon: p.lon };
  });
}
// the futures month the board itself posts for a row (the frozen shard's futuresMonth, CME month code), so no
// expectation below is a month typed into the test: change the fixture and the expectations follow
const CME = "FGHJKMNQUVXZ", MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function boardMonth(shardFile, crop, delivery) {
  const b = fx(shardFile).bids.find((x) => x.crop === crop && x.delivery === delivery);
  assert.ok(b && /^Z[CS][FGHJKMNQUVXZ]\d\d$/.test(b.futuresMonth), crop + " " + delivery + " has a board contract in the fixture");
  const mon = MON[CME.indexOf(b.futuresMonth[2])];
  return { mon, label: mon + " '" + b.futuresMonth.slice(3), cents: b.basisCents };
}
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const cellOf = (html, crop) => {
  const i = html.indexOf('<span class="bh-ck">' + crop);
  assert.ok(i >= 0, crop + " cell drawn");
  return html.slice(i, html.indexOf('<span class="bh-cell', i + 10) > 0 ? html.indexOf('<span class="bh-cell', i + 10) : html.indexOf("bh-chev", i));
};

test("River Country Bloomer soybeans: the board's own contract, Jan '27, like the Bloomer town page", async () => {
  const H = load();
  const rows = rowsOf("River Country Co-op||Bloomer|WI");
  await H.loadShardPaths([rows[0].shard]);
  const elev = H.groupByElevator(rows)[0];
  const html = H.renderElevatorHTML(elev, "all", false, ["corn", "soybeans"], true, "");
  const soy = cellOf(html, "Soybeans");
  const RC = "river-country-co-op-bloomer-wi-ac046dc1.json";
  const sb = boardMonth(RC, "soybeans", "HAR 26"), cb = boardMonth(RC, "corn", "HAR 26");
  assert.match(soy, new RegExp("−" + -sb.cents + "¢</span><span class=\"bh-refm\">\\s*" + sb.mon + "<"), "soy cell names the board's month");
  assert.match(html, new RegExp("basis vs " + esc(sb.label)), "expanded row names the board's contract");
  // every contract the row names is one the board posts (the clock's nearby soybean month, Nov '26, would not be)
  const named = [...html.matchAll(/basis vs ([A-Z][a-z]{2} '\d\d)/g)].map((m) => m[1]);
  assert.ok(named.length >= 1);
  for (const n of named) assert.ok([sb.label, cb.label].includes(n), "a contract the board posts: " + n);
  // (the Bloomer town page, a generated set, printed "vs Jan '27" for this row on Nov 9; not read here: a cron rewrites it)
  // HAR 26 is the harvest window, not "Nov"
  assert.match(soy, /<span class="bh-mon"><span class="bh-vh">for <\/span>Harvest<\/span>/);
  assert.match(html, /<div class="bh-per">Harvest 2026<\/div>/);
  // corn: board posts ZCZ26
  assert.match(cellOf(html, "Corn"), new RegExp("class=\"bh-refm\">\\s*" + cb.mon + "<"));
});

test("CDR Farms Bloomer corn: the board names no contract, so the card names none", async () => {
  const H = load();
  const rows = rowsOf("CDR Farms LLC||Bloomer|WI");
  await H.loadShardPaths([rows[0].shard]);
  const html = H.renderElevatorHTML(H.groupByElevator(rows)[0], "all", false, ["corn", "soybeans"], true, "");
  const corn = cellOf(html, "Corn");
  assert.match(corn, /−65¢<\/span><span class="bh-refm"><\/span>/, "no month after the basis");
  assert.doesNotMatch(html, /data-ref-crop|basis vs [A-Z][a-z]{2}\b/, "no month inferred either");
});

test("when the board's file cannot be read, an inferred month says so and rolls past first notice", async () => {
  const H = load({ shards: false });
  const rows = rowsOf("River Country Co-op||Bloomer|WI");
  const html = H.renderElevatorHTML(H.groupByElevator(rows)[0], "all", false, ["corn", "soybeans"], true, "");
  const els = [];
  html.replace(/<span class="(r7-ref|bh-refm)"([^>]*)>/g, (m, cls, attrs) => {
    const a = {}; attrs.replace(/ (data-[\w-]+)="([^"]*)"/g, (x, k, v) => { a[k] = v.replace(/&amp;/g, "&"); });
    els.push({ cls, a, textContent: "", title: "", getAttribute: (k) => (k in a ? a[k] : null), classList: { contains: (c) => c === cls } });
  });
  assert.ok(els.length >= 4, "ref slots found: " + els.length);
  const area = { querySelectorAll: () => els, querySelector: () => null };
  H.fillRefs(area);
  await new Promise((r) => setTimeout(r, 50));
  const soy = els.filter((e) => e.a["data-ref-crop"] === "soybeans");
  assert.ok(soy.length >= 2);
  for (const e of soy) assert.match(e.textContent, e.cls === "bh-refm" ? /^ ~Jan$/ : /^basis vs Jan '27 \(inferred\)$/); // pin-ok: page clock pinned above
  assert.equal(H.refCandidate("soybeans", "2026-10", "2026-10-29").key, "beans-nov26"); // pin-ok: inline
  assert.equal(H.refCandidate("soybeans", "2026-10", "2026-10-30").key, "beans-jan27"); // pin-ok: inline, first notice day
  assert.equal(H.refCandidate("corn", "2026-11", "2026-11-30").key, "corn-mar27"); // pin-ok: inline
});

/* ---------- #504: the pure rules, taken from the shipped files ---------- */
// one named function's source, brace matched, so the test runs the code the page runs
function fnSrc(file, name) {
  const s = read(file), i = s.indexOf("function " + name + "(");
  assert.ok(i >= 0, name + " is in " + file);
  let d = 0, j = s.indexOf("{", i);
  for (; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}" && --d === 0) break; }
  return s.slice(i, j + 1);
}
const fns = (file, names, ret) => new Function(names.map((n) => fnSrc(file, n)).join("\n") + "\nreturn " + ret + ";")();

test("conditions are not printed under the Nov 8 harvest week (corn rated Oct 25, soybeans Oct 11)", () => {
  const geUnderHarvest = fns("components/home-season.js", ["rateWeek", "geUnderHarvest"], "geUnderHarvest");
  const cp = fx("crop-progress-2026-11-08.json"); // the NASS file the page read Nov 9
  const hd = cp.corn.harvest_date;
  assert.equal(hd, "2026-11-08"); // pin-ok: fixture copy
  assert.deepEqual(geUnderHarvest(cp, hd), [], "neither rating is from the harvest week");
  // the same file in a week NASS rated corn: only corn prints
  const rated = { ...cp, corn: { ...cp.corn, report_date: hd } };
  assert.deepEqual(geUnderHarvest(rated, hd), ["Corn 56%"]);
  // no harvest week: each crop's own week, both print
  assert.deepEqual(geUnderHarvest(cp, null), ["Corn 56%", "soybeans 57%"]);
});

test("one CT stamp: a last trade is stamped from its close_time, not the file's read time", () => {
  const stampAt = fns("components/home-yield.js", ["stampAt"], "stampAt");
  const px = fx("prices.json"), F = new Date(px.fetched), cq = px.quotes["corn-nearby"] || px.quotes.corn;
  const ct = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(d);
  assert.equal(ct(F), "1:46 PM", "the file was read at 1:46 PM CT");
  assert.equal(ct(stampAt(cq, F)), "1:20 PM", "the ticker names the 1:20 PM CT last trade, the cards' time");
  assert.equal(stampAt({ ...cq, close_kind: "settle" }, F), F, "a settle keeps the file's own path");
  assert.equal(stampAt({ ...cq, close_time: "bad" }, F), F, "an unreadable close_time falls back to the read time");
});

test("the nowcast: ratings 15 days old are shown, 16 days withheld (week ending Oct 4)", () => {
  const ncWithheld = fns("components/home-yield.js", ["ncWithheld"], "ncWithheld");
  const we = "2026-10-04"; // pin-ok: inline, the corn week_ending in the Nov 9 nowcast file
  const at = (day, h) => Date.UTC(2026, 9, day, h); // October
  assert.equal(ncWithheld(we, at(19, 23)), false, "15 days and 23 hours: shown");
  assert.equal(ncWithheld(we, at(20, 0)), true, "16 days: withheld");
  assert.equal(ncWithheld(we, Date.UTC(2026, 10, 9, 12)), true, "Nov 9, the page as read: withheld");
  assert.equal(ncWithheld("", at(5, 0)), true, "no week: withheld");
});

test("RMA dates: the card runs through the latest final planting date in the file (28 Northeast soybean counties) and stops after it", () => {
  const src = read("components/home-planting.js");
  const last = JSON.parse(src.match(/var RMA_LAST=(\[\d+,\d+\])/)[1]);
  const rmaPast = new Function("var RMA_LAST=" + JSON.stringify(last) + ";\n" + fnSrc("components/home-planting.js", "rmaPast") + "\nreturn rmaPast;")();
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rma = JSON.parse(read("data/rma-planting-dates.json"));
  let max = [0, 0];
  for (const c of Object.values(rma.counties)) for (const k of ["corn", "soybeans"]) {
    const m = /^([A-Z][a-z]{2}) (\d+)$/.exec(c[k] || ""); if (!m) continue;
    const v = [MO.indexOf(m[1]) + 1, +m[2]];
    if (v[0] > max[0] || (v[0] === max[0] && v[1] > max[1])) max = v;
  }
  assert.deepEqual(last, max, "RMA_LAST is the latest date in data/rma-planting-dates.json");
  // noon CT on the latest date: still shown; the next day: past
  const noonCT = (m, d) => new Date(Date.UTC(2026, m - 1, d, 17));
  assert.equal(rmaPast(noonCT(max[0], max[1])), false, "the latest date itself is shown");
  assert.equal(rmaPast(noonCT(max[0], 1)), false, "the first of that month is shown");
  assert.equal(rmaPast(noonCT(max[0], max[1] + 1)), true, "the day after: not fetched");
  assert.equal(rmaPast(noonCT(12, 1)), true);
  assert.equal(rmaPast(noonCT(6, 30)), false);
  // the real case: 28 counties' soybean date (16 Maine, 10 New Hampshire, 2 Virginia) was hidden Jul 1 to 5 by a July cutoff
  const lastTxt = MO[max[0] - 1] + " " + max[1];
  const hit = Object.values(rma.counties).filter((c) => c.soybeans === lastTxt || c.corn === lastTxt);
  assert.ok(hit.length >= 28, "counties on the latest date: " + hit.length);
});

test("rent card: the rent page's land type, named, and no rent more than three survey years old shown as current", () => {
  const rentPick = fns("components/home-season.js", ["rentLead", "rentPick"], "rentPick");
  const CA = fx("cash-rent-CA.json"), CO = fx("cash-rent-CO.json"); // the NASS files /rent/california and /rent/colorado were built from, Nov 10
  // Fresno CA: the rent page leads with irrigated, so the card shows irrigated $305, not dryland $22
  const fr = rentPick(CA, "Fresno County");
  assert.equal(fr.lead.kind, "irr");
  assert.deepEqual([fr.main.word, fr.main.value, fr.main.old], ["irrigated", 305, false]);
  // Colusa CA: dryland was last published 2021; the card leads with its current irrigated rent, never "$28, 2021"
  const co = rentPick(CA, "Colusa County");
  assert.deepEqual([co.main.word, co.main.value, co.main.old], ["irrigated", 375, false]);
  assert.ok(co.other.old && co.other.value === 28, "the 2021 dryland rent is old, so it is not printed beside it");
  // Otero CO: dryland $35 is from 2009; irrigated (Colorado's lead) $155
  const ot = rentPick(CO, "Otero County");
  assert.equal(ot.lead.kind, "irr");
  assert.deepEqual([ot.main.value, ot.main.old, ot.other.value, ot.other.old], [155, false, 35, true]);
  // a lead-kind rent more than three survey years old is n/a with its year: Tuolumne CA irrigated, last 2011
  const tu = rentPick(CA, "Tuolumne");
  assert.equal(tu.main.old, true);
  assert.equal(tu.main.year, tu.lead.year - 15);
  // the California state fallback is the irrigated median the rent page leads with ($437), not dryland $34.75
  const none = rentPick(CA, "Nowhere");
  assert.equal(none.main, null);
  assert.equal(none.word, "irrigated");
  assert.equal(none.lead.median, 437);
  // the card's words: every rent line names its land type, an old one says n/a
  const src = read("components/home-season.js");
  assert.match(src, /'n\/a <small>'\+r\.word\+', last published '\+r\.year/);
  assert.doesNotMatch(src.slice(src.indexOf("function rent()"), src.indexOf("function prf()")), /cards\.json/, "the card no longer reads the Atlas dryland field");
});
