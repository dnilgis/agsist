/* Benchmark review, Oct 29, 2026: the futures pages showed the quote's time at the price but its
 * delay and any stale state only further down. A line right under the hero price now says it:
 * "Delayed 10 to 25 min" for a fresh last trade, "Exchange settle, not a live trade" for a
 * settle, "Stale: ..." once the file stops updating, "Not updating: last price on file" when
 * the price file does not load. Fixture: data/prices.json as committed 2026-10-19 03:16 UTC.
 *   node --test test/futures-fresh.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const FIX = join(ROOT, "test/fixtures/futures-when/prices-2026-10-19T0316Z.json");
const PAGES = ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html"];

/* asof.js, price-local.js and heroFresh in one sandbox whose clock reads `now` */
function load(now) {
  const js = read("components/futures.js");
  const m = /function heroFresh\(q,data,failed\)\{[\s\S]*?\n\}/.exec(js);
  assert.ok(m, "heroFresh found");
  const RealDate = Date;
  const T = new RealDate(now).getTime();
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }
  const el = { textContent: "", cls: new Set(), classList: { toggle(c, on) { on ? el.cls.add(c) : el.cls.delete(c); } } };
  const doc = { readyState: "complete", querySelectorAll: () => [], getElementById: (id) => (id === "ph-fresh" ? el : null), addEventListener() {} };
  const win = { addEventListener() {}, document: doc };
  const ctx = vm.createContext({ window: win, document: doc, navigator: { onLine: true }, setInterval() {}, setTimeout() {}, Intl, Date: FakeDate, module: { exports: {} } });
  vm.runInContext(read("components/asof.js"), ctx);
  vm.runInContext(read("components/price-local.js"), ctx);
  if (!win.AgPxStamp) win.AgPxStamp = ctx.module.exports;
  ctx.AgPxStamp = win.AgPxStamp; ctx.AgAsOf = win.AgAsOf;
  const fn = vm.runInContext("(" + m[0] + ")", ctx);
  return { run: (...a) => (fn(...a), el) };
}

test("every grain futures page holds the line under the price from the first paint", () => {
  for (const p of PAGES) {
    const h = read(p);
    assert.match(h, /<div class="ph-unit">[\s\S]*?<\/div><div class="ph-fresh" id="ph-fresh">Quotes delayed 10 to 25 min<\/div>/, p);
    assert.match(h, /\.ph-fresh\{[^}]*min-height:1\.35em/, p);
    assert.match(h, /futures\.js\?v=29/, p);
  }
});

test("Sunday night, Friday settle: says settle, not delayed and not stale", () => {
  const p = JSON.parse(readFileSync(FIX, "utf8"));
  const h = load("2026-10-19T03:20:00Z");
  const el = h.run(p.quotes["corn-nearby"], p);
  assert.equal(el.textContent, "Exchange settle, not a live trade");
  assert.ok(!el.cls.has("is-stale"));
});

test("a settle the file never moved past says stale", () => {
  const p = JSON.parse(readFileSync(FIX, "utf8"));
  const h = load("2026-10-21T15:00:00Z"); /* Wednesday: Monday and Tuesday settles are missing */
  const el = h.run(p.quotes["corn-nearby"], p);
  assert.match(el.textContent, /^Stale: settle is \d+ days old$/);
  assert.ok(el.cls.has("is-stale"));
});

test("in session: a fresh last trade says delayed; one the file stopped updating says stale", () => {
  const p = JSON.parse(readFileSync(FIX, "utf8"));
  p.fetched = "2026-10-19T15:42:00Z";
  const q = Object.assign({}, p.quotes["corn-nearby"], { close_kind: "last", close_time: "2026-10-19T15:42:00Z", close_date: "2026-10-19" });
  let el = load("2026-10-19T15:50:00Z").run(q, p);
  assert.equal(el.textContent, "Delayed 10 to 25 min");
  assert.ok(!el.cls.has("is-stale"));
  el = load("2026-10-19T17:45:00Z").run(q, p);
  assert.equal(el.textContent, "Stale: prices 2 hours old");
  assert.ok(el.cls.has("is-stale"));
});

test("the price file did not load: says so at the price", () => {
  const el = load("2026-10-19T15:50:00Z").run(null, null, true);
  assert.equal(el.textContent, "Not updating: last price on file");
  assert.ok(el.cls.has("is-stale"));
  const js = read("components/futures.js");
  assert.match(js, /setTxt\('ph-when',__when\);\n    heroFresh\(front,data\);/);
  assert.match(js, /heroFresh\(null,null,true\);/);
});
