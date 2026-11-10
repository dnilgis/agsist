/* Futures pages wording, Nov 10 2026, from the real cases:
 *   1. delayed quotes called "live" or "real-time" (soybean crush FAQ "from real-time soy complex
 *      prices", cattle JSON-LD "Live CME ... futures", the cattle fallback "Live CME futures").
 *   2. the delay said three ways ("delayed about 15 min", "a 10-minute exchange delay", "10 to 25
 *      min") and the stamp "Last trade as of 1:46 pm CT", which was the time the file was read.
 *   4. the cattle curve note said "five contracts in all" over four points.
 *   6. the cattle cards said LE=F and GF=F over Dec '26 and Nov '26 contracts.
 *   7. fast-facts printed quotes.beans, Yahoo's continuous series: the Jan '27 close beside the
 *      Nov '26 settle past first notice.
 *   8. the soybean crop progress card said week ending Oct 11 under a hero on Nov 1.
 *   9. "historically a weak pricing window"; today and tomorrow by the reader's clock.
 * Simplifier: one data line at the top of the cattle page, one closed Sources and terms fold.
 *
 *   node --test test/futures-wording.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const require = createRequire(import.meta.url);
const P = require(ROOT + "components/price-local.js");
const PAGES = ["corn-futures-prices.html", "soybean-futures-prices.html", "wheat-futures-prices.html",
  "cattle-futures-prices.html", "markets.html", "index.html"];

/* "live" that names a quote. Live cattle, aria-live, the live nav swap and code identifiers are not quotes. */
const NOT_A_QUOTE = /live ?cattle|live-cattle|aria-live|livestock|live \(le\)|feeder ?\/ ?live|\/live ratio|feeder.to.live|live contract|live and feeder|live & feeder|feeder vs live|feeder over live|feeder ÷ live|live weight|live, all grades|live nav|live footer|data-mode="live"|live timer|live cards|live label|live quote lands|live swap|live draw|live month|live radar|live, from windy|'delayed' live|\blive\)|\(live\b|live=|<=live|cwt\(live\)|live!=null|var live|live dated|live\+feeder|live \+ feeder|tariffs are live/i;

test("no delayed quote is called live or real-time: pages, JSON-LD, meta, fallbacks", () => {
  let seen = 0;
  for (const f of PAGES) {
    // code and markup comments are not copy a reader sees (a JS line comment needs a space before //, so URLs stay)
    const h = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[\s;{}])\/\/[^\n]*/g, "$1")
      .replace(/<style[\s\S]*?<\/style>/g, "").replace(/\s(class|id|src)="[^"]*"/g, "");   // a script path (report-live.js) is not copy either
    for (const m of h.matchAll(/.{0,40}\b(live|real-time|realtime)\b.{0,40}/gi)) {
      seen++;
      if (NOT_A_QUOTE.test(m[0])) continue;
      assert.fail(`${f}: "${m[0].trim()}"`);
    }
  }
  assert.ok(seen >= 40, `only ${seen} uses of live looked at; the pages have moved`);
  assert.doesNotMatch(read("soybean-futures-prices.html"), /real-time soy complex/);
  const cat = read("cattle-futures-prices.html");
  assert.doesNotMatch(cat, /Live CME futures|"description":"Live CME/);
  assert.doesNotMatch(cat, /Live prices unavailable/);
});

test("one delay statement: delayed 10 to 25 min, never 'a 10-minute delay'; 'about 15' only in the footer source line", () => {
  let n = 0;
  for (const f of PAGES) {
    // the grain pages' footer source line keeps main's words, "Prices from Yahoo Finance (delayed
    // about 15 min)", with no chart-site link; that one line is the only "about 15" a page may carry
    const raw = read(f);
    assert.ok((raw.match(/Prices from Yahoo Finance \(delayed about 15 min\)/g) || []).length <= 1, f);
    assert.doesNotMatch(raw, /TradingView link/, f);
    const h = raw.replace(/Prices from Yahoo Finance \(delayed about 15 min\)/, "");
    assert.doesNotMatch(h, /delayed about 15|delayed ~15|10-minute exchange delay|delayed about 10 to 25/i, f);
    n += (h.match(/delayed 10 to 25 min/g) || []).length;
  }
  assert.ok(n >= 12, `the one delay statement appears only ${n} times`);
  assert.equal(P.DELAY, "quotes delayed 10 to 25 min");
});

test("the stamp is the time the site read the quote, never 'last trade as of' it", () => {
  for (const f of ["components/price-local.js", "components/futures.js", "components/breakeven.js", "cattle-futures-prices.html", "index.html"])
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ""), /[Ll]ast trade as of/, f);
  // Nov 9, 2026 1:46 pm CT file (data/prices.json at 19:46Z): Dec live cattle, in session until 1:05 pm, read after it
  const fetched = "2026-11-09T19:46:21Z", now = Date.parse("2026-11-09T20:00:00Z");
  const le = { ticker: "LEZ26.CME", close: 216.325, close_kind: "last", close_date: "2026-11-09", close_time: "2026-11-09T19:05:00Z" };
  assert.equal(P.stamp(le, fetched, now).replace(/ /g, " "), "Last trade at the 1:05 pm CT bell; settle not posted yet");
  // the same contract read at 12:16 pm CT, in session: the read time and the delay
  const ins = { ...le, close_time: "2026-11-09T18:16:00Z" };
  assert.equal(P.stamp(ins, "2026-11-09T18:16:00Z", now).replace(/ /g, " "), "Read 12:16 pm CT; quotes delayed 10 to 25 min");
  assert.deepEqual(P.stampParts(ins, "2026-11-09T18:16:00Z", now).kind, "read");
  assert.match(P.html(ins, "2026-11-09T18:16:00Z", now), /datetime="2026-11-09T18:16:00Z"/);
});

test("cattle: cards name their contract month; the curve counts the contracts it draws", () => {
  const c = read("cattle-futures-prices.html");
  assert.doesNotMatch(c, /LE=F|GF=F/, "no Yahoo ticker on a card");
  assert.match(c, /\[\['le-tk',le\],\['gf-tk',gf\]\]\.forEach[^;]*AgPxStamp\.label\(t\[1\]\.ticker\)/);
  assert.equal(P.label("LEZ26.CME"), "Dec '26");
  assert.equal(P.label("GFX26.CME"), "Nov '26");
  assert.doesNotMatch(c, /five contracts in all|every live cattle contract/);
  const src = c.match(/function fwdCount\(n\)\{[^\n]*\}/)[0];
  const ctx = {}; vm.runInNewContext(src + ";this.f=fwdCount;", ctx);
  assert.equal(ctx.f(4), "four contracts");
  assert.equal(ctx.f(5), "five contracts");
  assert.equal(ctx.f(7), "7 contracts");
  assert.match(c, /fn\.textContent=fwdCount\(pts\.length\)/);
});

test("cattle: one data line at the top, every source in one closed Sources and terms fold", () => {
  const c = read("cattle-futures-prices.html");
  // the seed note between SEED markers is built on main by seed_static.py: its builder is checked here instead
  const top = c.slice(c.indexOf('<main'), c.indexOf('id="cattle-dashboard"')).replace(/<!--SEED:note-->[\s\S]*?<!--\/SEED-->/, "");
  const seed = read("scripts/seed_static.py"), cn = seed.slice(seed.indexOf('note = ("Live cattle "'), seed.indexOf('t, c2 = seed_between(t, "note", note)', seed.indexOf('note = ("Live cattle "')));
  assert.ok(cn.length > 50 && !/Yahoo|updated every 15/.test(cn), "the cattle seed note carries no second source line");
  assert.equal((top.match(/Yahoo Finance|USDA AMS|CFTC|Updated every 15 min/g) || []).length, 1, "one data line before the first card");
  assert.match(top, /<p class="madeby"[^>]*>Data: CME Group futures via Yahoo Finance, delayed 10 to 25 min\./);
  const fold = c.match(/<details class="hp-terms"[^>]*>[\s\S]*?<\/details>/)[0];
  assert.doesNotMatch(fold.slice(0, fold.indexOf(">")), /\bopen\b/, "the fold starts closed");
  for (const s of ["Yahoo Finance", "CME Group", "USDA AMS", "USDA RMA", "CFTC", "USDA NASS", "delayed 10 to 25 min"]) assert.ok(fold.includes(s), "fold names " + s);
  assert.match(fold, /id="fwd-kind"/, "the curve note moved into the fold, still filled by the page");
  assert.doesNotMatch(c, /class="ctcot-src"|<div class="method-note">USDA AMS cash prices/);
});

test("cattle, auction and LRP: RMA's value is its own section, never paired with our index", () => {
  for (const f of ["cattle-futures-prices.html", "cattle-auction-prices.html", "lrp.html"]) {
    const h = read(f);
    assert.doesNotMatch(h, /class="fx-pair"/, f);
    assert.match(h, /data-feeder="rma"/, f);
  }
  const comp = read("components/feeder-index.js");
  assert.match(comp, /<h2 class="fx-lbl">Feeder steers, RMA LRP value<\/h2>/, "its own heading");
  assert.match(comp, /Source: USDA RMA, Livestock Risk Protection actual ending values\./, "its own source line");
});

test("markets: no CME chart claim; a closed Sources and terms fold names the sources", () => {
  const m = read("markets.html");
  assert.doesNotMatch(m, /CME chart/i);
  const fold = m.match(/<details class="hp-terms" id="mk-sources"[^>]*>[\s\S]*?<\/details>/);
  assert.ok(fold, "markets has the fold");
  assert.doesNotMatch(fold[0].slice(0, fold[0].indexOf(">")), /\bopen\b/);
  for (const s of ["Yahoo Finance", "delayed 10 to 25 min", "Capital.com CFD", "not the CME contract", "AGSIST elevator network"]) assert.ok(fold[0].includes(s), s);
});

test("fast facts and break-even read the nearby contract and print its month, never the bare key", () => {
  // Nov 9, 2026 file: quotes.beans is ZS=F at 1187.0 (Jan) with the Nov settle 1189.0; beans-nearby is ZSF27
  const data = { quotes: {
    beans: { ticker: "ZS=F", close: 1187.0, settle: 1189.0, settle_date: "2026-11-06" },
    "beans-nearby": { ticker: "ZSF27.CBT", close: 1187.0, settle: 1193.75, settle_date: "2026-11-06" },
    "beans-nov": { ticker: "ZSX26.CBT", close: 1184.75 },
    "wheat-nearby": { ticker: "ZWZ26.CBT", close: 587.5 }, wheat: { ticker: "ZW=F", close: 587.5 } } };
  const h = P.headline(data, "beans");
  assert.equal(h.key, "beans-nearby");
  assert.equal(h.label, "Jan '27");
  assert.equal(P.headline(data, "wheat").label, "Dec '26");
  const ff = read("components/fast-facts.js");
  assert.doesNotMatch(ff, /q\.beans&&q\.beans\.close|q\.corn&&q\.corn\.close|q\.wheat&&q\.wheat\.close/);
  assert.match(ff, /tile\('fft-beans',hb\)/);
  assert.match(ff, /'CBOT '\+h\.label\+', delayed'/);
  const be = read("components/breakeven.js");
  assert.match(be, /_livePrices\['wheat-nearby'\]/);
  assert.doesNotMatch(be, /'last trade' \+ t|toLocaleString\(\[\], \{ month: 'short', day: 'numeric', hour/);
});

test("soybean crop progress card reads the newest week in the file, as the hero does", () => {
  const fut = read("components/futures.js");
  const src = fut.match(/function cropHarvestWeek\(d\)\{[^\n]*\}/)[0] + "\n" + fut.match(/function cropWeekLabel\(iso\)\{[^\n]*\}/)[0];
  const ctx = {}; vm.runInNewContext(src + ";this.h=cropHarvestWeek;this.l=cropWeekLabel;", ctx);
  // data/crop-progress.json, Nov 9 2026: soybeans condition week Oct 11, harvest week Nov 8
  const soy = { good_excellent: 57, report_date: "2026-10-11", harvest_pct: 92, harvest_date: "2026-11-08", harvest_5yr_avg: 91 };
  assert.equal(ctx.h(soy), "2026-11-08");
  assert.equal(ctx.l("2026-11-08"), "Nov 8");
  assert.equal(ctx.h({ good_excellent: 60, report_date: "2026-08-02" }), null, "no harvest: the condition week");
  assert.match(fut, /'Week ending '\+cropWeekLabel\(wk\)/);
  assert.match(fut, /last rated week ending '\+cropWeekLabel\(d\.report_date\)/);
});

test("no forecast wording; today and tomorrow by the Central calendar", () => {
  for (const f of ["components/futures.js", ...PAGES]) assert.doesNotMatch(read(f), /weak pricing window/, f);
  const fut = read("components/futures.js");
  const src = fut.match(/function ctISODate\(d\)\{[^\n]*\}/)[0];
  const ctx = {}; vm.runInNewContext(src + ";this.f=ctISODate;", ctx);
  assert.equal(ctx.f(new Date("2026-11-11T02:30:00Z")), "2026-11-10", "8:30 pm CT Nov 10 is still Nov 10 (UTC says Nov 11)");
  assert.equal(ctx.f(new Date("2026-11-10T06:30:00Z")), "2026-11-10");
  assert.doesNotMatch(fut, /var today=new Date\(\)\.toISOString\(\)\.slice\(0,10\)/);
  assert.doesNotMatch(fut, /var today=new Date\(\);today\.setHours\(0,0,0,0\);/);
});
