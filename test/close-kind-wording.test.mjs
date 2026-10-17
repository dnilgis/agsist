/* Settle vs last-trade wording and livestock rounding (Oct 17, 2026 re-score).
 *
 * The cards on /markets showed the Oct 16 settles while the footer said "not CME
 * settlements" and the FAQ said "Friday's last delayed quote"; the corn and soybean
 * FAQs said the weekend price is "not the official CME settlement"; the cattle curve
 * note said "last trade" over settle points. Feeders read $343.62 (title), $343.63
 * (home ticker) and $343.625 (/markets) for one settle, 343.625.
 *
 *   node --test test/close-kind-wording.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const UTIL = read("components/util.js");
const SENT = "After the close, the price shown is the exchange settle, read once the day's settle is posted; during the session it is the latest delayed trade.";
const py = (code) => execFileSync("python3", ["-c", code], { cwd: ROOT + "scripts", encoding: "utf8" }).trim();

const strip = (h) => h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "").replace(/&rsquo;|’/g, "'");

test("FAQ: the settle sentence is on /markets, corn and soybeans, visible and in the structured data", () => {
  for (const f of ["markets.html", "corn-futures-prices.html", "soybean-futures-prices.html"]) {
    const h = read(f);
    assert.ok(strip(h).includes(SENT), f + " visible FAQ");
    const ld = h.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g).join("\n").replace(/’/g, "'");
    assert.ok(ld.includes(SENT), f + " FAQ JSON-LD");
    assert.doesNotMatch(h, /Weekend prices show|last delayed quote|not the official CME settlement|not CME settlements\)/, f);
  }
  // the structured data is derived from the visible FAQ and must match it exactly
  execFileSync("python3", ["scripts/bake_faq.py", "--check"], { cwd: ROOT, encoding: "utf8" });
});

function mkSourceFromPage() {
  const h = read("markets.html");
  const src = h.match(/var MK_NAMES=[\s\S]*?\n  function chgCls/)[0].replace(/\n  function chgCls$/, "");
  const map = [...h.matchAll(/\{key:'([a-z0-9-]+)',\s*p:'/g)].map((m) => ({ key: m[1] }));
  const ctx = {};
  vm.runInNewContext(src + "\nthis.mkSource=mkSource;", ctx);
  return (q) => ctx.mkSource(q, map);
}

test("/markets source line follows close_kind, and the page script and the build agree", () => {
  const js = mkSourceFromPage();
  const prices = JSON.parse(read("data/prices.json"));
  const cases = [
    {},
    { corn: { close: 474.25, close_kind: "settle" }, crude: { close: 101.41, close_kind: "last" } },
    { corn: { close: 474.25, close_kind: "settle" }, cattle: { close: 227.55, close_kind: "settle" } },
    { crude: { close: 101.41, close_kind: "last" }, gold: { close: 4181.1 } },
    { corn: { close: 1, close_kind: "last" }, beans: { close: 1, close_kind: "last" }, cattle: { close: 1, close_kind: "settle" } },
    prices.quotes,
  ];
  for (const q of cases) {
    const fromPy = py("import json, seed_static as s; print(s.mk_source(json.loads(" + JSON.stringify(JSON.stringify(q)) + ")))");
    assert.equal(js(q), fromPy, JSON.stringify(q).slice(0, 80));
  }
  assert.equal(js(cases[2]), "Every card shows the exchange settle. Quotes from Yahoo Finance, refreshed every 15 minutes in session.");
  assert.equal(js(cases[1]), "Exchange settles, except the latest delayed trade for Crude WTI. Quotes from Yahoo Finance, refreshed every 15 minutes in session.");
  assert.equal(js(cases[3]), "Every card shows the latest delayed trade, not the exchange settle. Quotes from Yahoo Finance, refreshed every 15 minutes in session.");
  assert.equal(js(cases[4]), "Latest delayed trades, except the exchange settle for Live cattle. Quotes from Yahoo Finance, refreshed every 15 minutes in session.");
  // the baked line is the build's words for the file on disk
  const baked = read("markets.html").match(/<!--SEED:mk:src-->([\s\S]*?)<!--\/SEED-->/)[1].replace(/&amp;/g, "&");
  assert.equal(baked, js(prices.quotes));
});

test("cattle curve method note says settle or last trade from the file", () => {
  const h = read("cattle-futures-prices.html");
  assert.doesNotMatch(h, /last trade in \$\/cwt/);
  assert.match(h, /<span id="fwd-kind">the settle after the close, the latest delayed trade in session<\/span>/);
  const src = h.match(/function fwdKind\(pts\)\{[\s\S]*?\n    \}/)[0];
  const ctx = {};
  vm.runInNewContext(src + "\nthis.f=fwdKind;", ctx);
  assert.equal(ctx.f([{ kind: "settle", sd: "2026-10-16" }, { kind: "settle", sd: "2026-10-16" }]), "the Oct 16 settle");
  assert.equal(ctx.f([{ kind: "last" }, { kind: "last" }]), "the latest delayed trade");
  assert.equal(ctx.f([{ kind: "settle", sd: "2026-10-16" }, { kind: "last" }]), "the settle where it is posted, the latest delayed trade otherwise");
});

test("livestock to the tick everywhere: 343.625 is $343.625, 227.55 stays $227.55", () => {
  const ctx = { window: {} };
  vm.runInNewContext(UTIL, ctx);
  const P = ctx.window.AG.px;
  assert.equal(P.cash(343.625), "$343.625");
  assert.equal(P.cash(227.5500030517578), "$227.55");     // float noise from the price file
  assert.equal(P.cash(66.92500305175781), "$66.925");
  assert.equal(P.cash(340.95001220703125), "$340.95");
  // Python twin, title and seed
  assert.equal(py("import pricefmt as p; print(p.cash(343.625), p.cash(227.5500030517578), p.cash(66.92500305175781))"), "$343.625 $227.55 $66.925");
  assert.equal(py("import seed_static as s; print(s.cwt_dollars({'close': 343.625}))"), "343.625");
  const cat = read("cattle-futures-prices.html");
  const feed = JSON.parse(read("data/prices.json")).quotes.feeders;
  if (feed && feed.close_kind === "settle" && feed.settle === 343.625) {
    assert.match(cat, /<title>CME Feeder Cattle Futures \$343\.625 /);
    assert.match(cat, /feeders near \$343\.625/);
  }
  assert.doesNotMatch(cat, /\$343\.6[23]\b/);
  assert.match(cat, /function cwt\(v\)\{return AG\.px\.cash\(v\);\}/);
  // the home ticker and cards (geo.js) print livestock with the same formatter
  const geo = read("components/geo.js");
  for (const k of ["cattle", "feeders", "hogs"]) assert.match(geo, new RegExp("'" + k + "':\\s+\\{[^}]*tick:true"), k);
  const g = { window: {}, document: { querySelectorAll: () => [], getElementById: () => null, addEventListener() {} }, console };
  g.AG = undefined;
  vm.runInNewContext(UTIL, g);
  g.AG = g.window.AG;
  const fns = geo.match(/function tickNum[\s\S]*?\nfunction fmtTickerPrice[\s\S]*?\n\}/);
  assert.ok(fns, "geo.js formatters found");
  const fnSrc = geo.slice(geo.indexOf("function tickNum"), geo.indexOf("function updatePriceEl"));
  vm.runInNewContext(fnSrc.replace(/fmtCentsDiff\(diff\)/g, "''") + "\nthis.fp=fmtPrice;this.ft=fmtTickerPrice;this.fc=fmtChange;", g);
  assert.equal(g.fp(343.625, 2, false, undefined, "$", false, true), "$343.625");
  assert.equal(g.ft(343.625, false, 2, "$", false, true), "$343.625");
  assert.equal(g.fp(227.55, 2, false, undefined, "$", false, true), "$227.55");
  assert.equal(g.fp(101.41, 2, false, undefined, "$", false, false), "$101.41");   // crude is not livestock
  assert.match(g.fc(343.625, 343.375, false, 0.25, 0.0728, true).text, /^▲ \+0\.25 /);
  // home.js change line and range ends for livestock
  const home = read("components/home.js");
  assert.match(home, /cattle:\{tk:1\},feeders:\{tk:1\},hogs:\{tk:1\}/);
  assert.match(home, /else if\(c\.tk\)t=s\+'\$'\+AG\.px\.cash\(a,\{dollar:false\}\)/);
});
