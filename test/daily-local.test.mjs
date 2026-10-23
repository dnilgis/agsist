/* components/daily-local.js: the reader's local line on /daily. Hand-worked
 * cases: which board is "best", the change since the trading day before,
 * rain sums, the empty state, and the location rules. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const L = createRequire(import.meta.url)(join(ROOT, "components/daily-local.js"));
const NOW = Date.parse("2026-10-16T15:00:00Z");   // Fri Oct 16, 10 am CT
const HOME = [45.3136, -91.6510];                  // Chetek, WI

const place = (name, lat, lon, now, extra = {}) => ({
  place: name + "||Town|WI", operator: name, city: "Town", state: "WI", currency: "USD",
  lat, lon, pricedAt: "2026-10-16T13:00:00Z", now, ...extra,
});
const corn = (cash, basisCents, period = "2026-10", commodity = "Corn") => ({ corn: { cash, basisCents, period, commodity } });
const IDX = { places: [
  place("Near", 45.33, -91.65, corn(3.80, -95)),                           // 1.2 mi
  place("Best", 45.60, -91.65, corn(3.95, -80)),                           // about 20 mi, highest October bid
  place("Later", 45.40, -91.65, corn(4.40, -60, "2026-12")),               // higher, but a later month
  place("Organic", 45.32, -91.65, corn(9.00, 400, "2026-10", "Organic Corn")),
  place("Stale", 45.31, -91.65, corn(4.50, -50), { pricedAt: "2026-10-14T13:00:00Z" }),
  place("Far", 46.80, -91.65, corn(5.00, -20)),                            // over 100 mi
  place("Loonie", 45.31, -91.66, corn(4.90, -10), { currency: "CAD" }),
] };

test("best = nearest open month, then highest cash; nearest named apart", () => {
  const p = L.pick(IDX, HOME[0], HOME[1], NOW);
  assert.equal(p.corn.best.name, "Best");
  assert.equal(p.corn.nearest.name, "Near");
  assert.equal(p.corn.n, 3, "organic, stale, far and CAD boards left out");
  assert.equal(p.soybeans.best, null);
});

test("change since the trading day before the board last posted", () => {
  const p = L.pick(IDX, HOME[0], HOME[1], NOW).corn.best;
  const key = L.fnv(p.place + "|corn|" + p.period);
  const shard = { rows: { [key]: [["2026-10-14", 3.97, -80], ["2026-10-15", 3.99, -80], ["2026-10-16", 3.95, -80]] } };
  assert.deepEqual(L.change(p, "corn", shard), { cents: -4, since: "Thu" });
  assert.equal(L.change(p, "corn", { rows: {} }), null, "no history: no change, never a zero");
  assert.equal(L.fnv("Abbyville Farmers Co-op Grain Co.||Abbyville|KS|corn|2026-08/2026-11"), "0dd84803");
});

test("rain sums the last 24 and 168 hours up to now", () => {
  const time = [], precipitation = [];
  const start = Date.parse("2026-10-09T00:00:00Z");
  for (let i = 0; i < 24 * 9; i++) {
    time.push(new Date(start + i * 36e5).toISOString().slice(0, 16));
    precipitation.push(i % 24 === 3 ? 0.1 : 0);   // 0.10 in at 03:00 UTC each day
  }
  const r = L.rain({ utc_offset_seconds: 0, hourly: { time, precipitation } }, NOW);
  assert.deepEqual(r, { h24: 0.1, d7: 0.7 });
  assert.equal(L.rain({ hourly: { time: time.slice(0, 50), precipitation: precipitation.slice(0, 50) } }, NOW), null);
});

test("the line reads plainly, and missing pieces stay missing", () => {
  const picks = L.pick(IDX, HOME[0], HOME[1], NOW);
  const h = L.build({ loc: { zip: "54728", label: "Chetek, WI" }, picks, changes: { corn: { cents: -4, since: "Thu" } }, rain: { h24: 0, d7: 1.23 } });
  assert.match(h, /Your local line: Chetek, WI/);
  assert.match(h, /<b>Corn<\/b> best bid \$3\.95 at Best, Town \(\d+\.\d mi\), 80¢ under futures, down 4¢ since Thu\. Nearest: Near, Town \(1\.\d mi\) \$3\.80\./);
  assert.match(h, /<b>Soybeans<\/b>: no bid posted in the last 36 hours within 50 miles\./);
  assert.match(h, /no rain over the last 24 hours, 1\.23 inch over the last 7 days/);
  assert.match(h, /\/cash-bids\?zip=54728/);
  assert.match(L.build({ loc: { zip: "54728" }, status: "failed" }), /could not be read/);
});

test("empty state asks for a ZIP and promises only what is true", () => {
  const h = L.empty();
  assert.match(h, /<input id="dl-zip"/);
  assert.match(h, /Saved in this browser only/);
});

test("location: saved spot first, then a saved ZIP; nothing else", () => {
  const ls = (m) => ({ getItem: (k) => (k in m ? m[k] : null) });
  assert.deepEqual(L.readLoc(ls({ "agsist-wx-loc": JSON.stringify({ lat: 45.3, lon: -91.6, zip: "54728", label: "Chetek, WI" }) })),
    { lat: 45.3, lon: -91.6, zip: "54728", label: "Chetek, WI" });
  assert.deepEqual(L.readLoc(ls({ agsist_zip: "54728" })), { lat: null, lon: null, zip: "54728", label: "" });
  assert.equal(L.readLoc(ls({ agsist_zip: "5472" })), null);
  assert.equal(L.readLoc(ls({})), null);
});

test("no em dashes, no tracking calls", () => {
  const s = readFileSync(join(ROOT, "components/daily-local.js"), "utf8");
  assert.ok(!s.includes("—"));
  assert.ok(!/gtag\(|sendBeacon|dataLayer/.test(s), "the local line reports nothing about the reader");
});

test("a reader with a saved location gets the line above the quote strip; no location keeps the ZIP box below it", () => {
  const el = (a) => ({ getAttribute: (k) => (k in a ? a[k] : null) });
  const box = el({ "data-before": "article .dv3-quotes", "data-after": "aside.ya[data-your-area]" });
  assert.deepEqual(L.spot(box, true), { sel: "article .dv3-quotes", before: true, fallback: "aside.ya[data-your-area]" });
  assert.deepEqual(L.spot(box, false), { sel: "aside.ya[data-your-area]", before: false, fallback: null });
  assert.deepEqual(L.spot(el({ "data-after": "x" }), true), { sel: "x", before: false, fallback: null }, "old issue pages keep their place");
  const page = readFileSync(join(ROOT, "daily.html"), "utf8");
  assert.match(page, /<aside class="dl" data-daily-local data-before="#dv3-today \.dv3-quotes" data-after="#dv3-today \.dv3-quote-asof" hidden><\/aside><script src="\/components\/daily-local\.js\?v=3" defer><\/script>/);
  const gen = readFileSync(join(ROOT, "scripts/generate_daily.py"), "utf8");
  assert.match(gen, /<aside class="dl" data-daily-local data-before="article \.dv3-quotes" data-after="aside\.ya\[data-your-area\]" hidden><\/aside>/);
  assert.match(gen, /daily-local\.js\?v=3/);
});
