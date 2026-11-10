/* Nov 10 home audit (feedbag notes/audits/home-audit-2026-11-09.md), each case from the real page.
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
  assert.match(soy, /−74¢<\/span><span class="bh-refm">\s*Jan</, "soy cell names Jan");
  assert.match(html, /basis vs Jan '27/, "expanded row names Jan '27");
  assert.doesNotMatch(html, /basis vs Nov '26/);
  // (the Bloomer town page, a generated set, printed "vs Jan '27" for this row on Nov 9; not read here: a cron rewrites it)
  // HAR 26 is the harvest window, not "Nov"
  assert.match(soy, /<span class="bh-mon"><span class="bh-vh">for <\/span>Harvest<\/span>/);
  assert.match(html, /<div class="bh-per">Harvest 2026<\/div>/);
  // corn: board posts ZCZ26
  assert.match(cellOf(html, "Corn"), /class="bh-refm">\s*Dec</);
});

test("CDR Farms Bloomer corn: the board names no contract, so the card names none", async () => {
  const H = load();
  const rows = rowsOf("CDR Farms LLC||Bloomer|WI");
  await H.loadShardPaths([rows[0].shard]);
  const html = H.renderElevatorHTML(H.groupByElevator(rows)[0], "all", false, ["corn", "soybeans"], true, "");
  const corn = cellOf(html, "Corn");
  assert.match(corn, /−65¢<\/span><span class="bh-refm"><\/span>/, "no month after the basis");
  assert.doesNotMatch(html, /data-ref-crop|basis vs (Dec|Mar|Jan|Nov)/, "no month inferred either");
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
