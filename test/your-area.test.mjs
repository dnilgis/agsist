/* The "Your area" box (components/your-area.js) on /daily, every issue page,
 * /scorecard, /cot and /whats-priced-in.
 *
 *   node --test test/your-area.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const Y = require(ROOT + "components/your-area.js");
const SRC = readFileSync(ROOT + "components/your-area.js", "utf8");
const NOW = Date.parse("2026-10-17T12:00:00Z");

const basis = {
  generated: "2026-10-16T22:28:03Z", prev: "2026-10-09T22:27:14Z",
  states: {
    WI: { name: "Wisconsin", path: "/cash-bids/wisconsin/#basis", crops: {
      corn: { contract: "ZCZ26", label: "Dec '26", n: 46, median: -0.565, wow: 0.0 },
      soybeans: { contract: "ZSX26", label: "Nov '26", n: 32, median: -0.82, wow: -2.0 } } },
    IA: { name: "Iowa", path: "/cash-bids/iowa/#basis", crops: {
      corn: { contract: "ZCZ26", label: "Dec '26", n: 263, median: -0.4, wow: 3.0 },
      soybeans: { contract: "ZSX26", label: "Nov '26", n: 1 } } },
  },
};
/* fetch_prices v3.7 after the Friday night run: the bars are the CBOT settles
   (Dec corn $4.74 1/4, -3 3/4; Nov beans $12.61 1/4, -1 3/4 on Oct 16). */
const prices = { quotes: {
  "corn-dec": { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-16", close_kind: "settle",
    settle: 474.25, settle_date: "2026-10-16", settle_net: -3.75 },
  "beans-nov": { ticker: "ZSX26.CBT", close: 1261.25, close_date: "2026-10-16", close_kind: "settle",
    settle: 1261.25, settle_date: "2026-10-16", settle_net: -1.75 } } };
const progress = { in_season: true, states: { WI: {
  corn_harvested: { date: "2026-10-11", pct: 16, avg5: 18 },
  soybeans_harvested: { date: "2026-10-11", pct: 54, avg5: 47 } } } };
const wpi = { latest_result: { date: "2026-10-09", report: "October WASDE", biggest_surprise: {
  reaction_from: "settles",
  reaction: "Dec '26 corn settled 20½¢ lower that day, $5.00¼ to $4.79¾ (CBOT daily settles as Yahoo Finance reports them)." } } };
const WI = { state: "WI", zip: "54728" };
const text = (h) => h.replace(/<\/?b>/g, "").replace(/<[^>]+>/g, " ").replace(/&middot;|&rarr;/g, " ").replace(/\s+/g, " ");

function store(o) { return { getItem: (k) => (k in o ? o[k] : null) }; }

test("hand-worked basis math: cash = futures + basis, to the cent", () => {
  // Dec corn $4.74 1/4 + WI median basis -56 1/2 cents = $4.1775 -> $4.18
  assert.equal(Y.cashAt(474.25, -0.565), 4.18);
  // Nov beans $12.60 1/2 - 82 cents = $11.785 -> $11.79
  assert.equal(Y.cashAt(1260.5, -0.82), 11.79);
  // Colorado corn +11 over: $5.00 + 0.11 = $5.11
  assert.equal(Y.cashAt(500, 0.11), 5.11);
  assert.equal(Y.basisWords(-0.565), "56½¢ under");
  assert.equal(Y.basisWords(0.11), "11¢ over");
  assert.equal(Y.basisWords(0), "even with");
  assert.equal(Y.fut(474.25), "$4.74¼");
  assert.equal(Y.fut(500.25), "$5.00¼");
  assert.equal(Y.fut(1260.5), "$12.60½");
  assert.equal(Y.fut(405), "$4.05");
  assert.equal(Y.wowWords(-4), "4¢ weaker on the week");
  assert.equal(Y.wowWords(3), "3¢ stronger on the week");
  assert.equal(Y.wowWords(0), "unchanged on the week");
  assert.equal(Y.wowWords(null), "");
});

test("with a saved location: state basis, implied cash, harvest pace, all dated", () => {
  const h = Y.build({ loc: WI, mode: "daily", basis, prices, progress, now: NOW });
  const t = text(h);
  assert.match(t, /Your area: Wisconsin/);
  assert.match(t, /Corn basis 56½¢ under Dec '26, unchanged on the week \(46 elevators\)\./);
  assert.match(t, /Dec '26 settled \$4\.74¼ Oct 16: about \$4\.18 at that basis\./);
  assert.match(t, /Soybeans basis 82¢ under Nov '26, 2¢ weaker on the week \(32 elevators\)\..*Nov '26 settled \$12\.61¼ Oct 16: about \$11\.79/);
  assert.doesNotMatch(t, /closed/);
  assert.match(t, /Harvest in Wisconsin: corn 16% \(5-yr avg 18%\), soybeans 54% \(5-yr avg 47%\)\./);
  assert.match(t, /bids as of Oct 16, week vs Oct 9/);
  assert.match(t, /USDA NASS crop progress, week ending Oct 11/);
  assert.match(h, /href="\/cash-bids\?zip=54728"/);
  assert.match(h, /href="\/cash-bids\/wisconsin\/#basis"/);
  assert.match(t, /Basis moves on its own and is not in the futures price/);
});

test("a last trade is never called settled or closed", () => {
  // 1:46 p.m. CT Oct 16: the bar is the last trade; the newest settle is Oct 15's
  const live = { quotes: { "beans-nov": { ticker: "ZSX26.CBT", close: 1260.5, close_date: "2026-10-16",
    close_kind: "last", close_time: "2026-10-16T18:20:00Z", settle: 1263, settle_date: "2026-10-15", settle_net: -14.25 } } };
  const t = text(Y.build({ loc: WI, mode: "daily", basis, prices: live, progress, now: NOW }));
  assert.match(t, /Nov '26 settled \$12\.63 Oct 15: about \$11\.81 at that basis\./);
  assert.doesNotMatch(t, /12\.60½/);
  // a file with no settle field (fetch_prices before v3.7) says last traded
  const old = { quotes: { "beans-nov": { ticker: "ZSX26.CBT", close: 1260.5, close_date: "2026-10-16" } } };
  const o = text(Y.build({ loc: WI, mode: "daily", basis, prices: old, progress, now: NOW }));
  assert.match(o, /Nov '26 last traded \$12\.60½ Oct 16/);
  assert.doesNotMatch(o, /closed|settled \$12\.60/);
});

test("a crop under the state's minimum count stays missing", () => {
  const t = text(Y.build({ loc: { state: "IA", zip: "50010" }, mode: "cot", basis, prices, progress, now: NOW }));
  assert.match(t, /Corn basis 40¢ under Dec '26, 3¢ stronger/);
  assert.doesNotMatch(t, /Soybeans basis/);
  assert.match(t, /an Iowa bid cent for cent/);
  assert.match(t, /Basis is not covered by futures or by this report/);
  assert.doesNotMatch(t, /Harvest/, "no Iowa row in the progress fixture");
});

test("no location: one small link to the ZIP search, nothing else", () => {
  assert.equal(Y.readLoc(store({})), null);
  assert.equal(Y.readLoc(store({ "agsist-wx-loc": "not json" })), null);
  const h = Y.none();
  assert.match(h, /href="\/cash-bids"/);
  assert.match(text(h), /^\s*See this for your area\s*$/);
});

test("saved location is read, never invented", () => {
  assert.deepEqual(Y.readLoc(store({ "agsist-wx-loc": JSON.stringify({ lat: 45, lon: -91, zip: "54728", state: "WI" }) })), WI);
  assert.deepEqual(Y.readLoc(store({ agsist_zip: "50010" })), { state: "", zip: "50010" });
  assert.deepEqual(Y.readLoc(store({ "agsist-wx-loc": JSON.stringify({ state: "Wisconsin" }), agsist_zip: "x" })), null);
  // ZIP only: no state is guessed, so no state figure prints
  const t = text(Y.build({ loc: { state: "", zip: "50010" }, mode: "scorecard", basis, prices, progress, now: NOW }));
  assert.doesNotMatch(t, /\$|%|elevators/);
  assert.match(t, /Bids near 50010/);
  assert.match(t, /graded on futures/);
});

test("no data files: no numbers, only the plain rule and the ZIP link", () => {
  const h = Y.build({ loc: WI, mode: "cot", basis: null, prices: null, progress: null, now: NOW });
  const t = text(h);
  assert.doesNotMatch(t, /\$|%|¢ under|elevators|as of/);
  assert.match(t, /Fund positions are national/);
  assert.match(h, /cash-bids\?zip=54728/);
});

test("stale or mismatched data is withheld", () => {
  const old = Y.build({ loc: WI, mode: "daily", basis, prices, progress, now: Date.parse("2026-11-10T12:00:00Z") });
  assert.doesNotMatch(text(old), /basis 56|Harvest/, "basis over 10 days old and progress over 21 days old");
  const other = { quotes: { c: { ticker: "ZCH27.CBT", close: 486.25, close_date: "2026-10-16" } } };
  const t = text(Y.build({ loc: WI, mode: "daily", basis, prices: other, progress, now: NOW }));
  assert.match(t, /Corn basis 56½¢ under Dec '26/);
  assert.doesNotMatch(t, /about \$/, "no implied cash from a different contract");
  const lag = { quotes: { c: { ticker: "ZCZ26.CBT", close: 474.25, close_date: "2026-10-01" } } };
  assert.doesNotMatch(text(Y.build({ loc: WI, mode: "daily", basis, prices: lag, now: NOW })), /about \$/);
});

test("what's priced in: the report's move at the reader's basis, checked against its own prices", () => {
  assert.deepEqual(Y.parseReaction(wpi.latest_result.biggest_surprise.reaction), { month: "Dec '26", crop: "corn", cents: 20.5, dir: "lower" });
  // 5.00 1/4 to 4.79 3/4 is 20 1/2; a typed 21 must be refused
  assert.equal(Y.parseReaction("Dec '26 corn settled 21¢ lower that day, $5.00¼ to $4.79¾"), null);
  assert.equal(Y.parseReaction("Old-crop carryout in line"), null);
  const t = text(Y.build({ loc: WI, mode: "wpi", basis, prices, progress, wpi, now: NOW }));
  assert.match(t, /The October WASDE \(Oct 9\) moved Dec '26 corn 20½¢ lower that day\. Where basis held, a Wisconsin corn bid moved the same 20½¢\. Basis is not covered by futures/);
  const typed = { latest_result: { ...wpi.latest_result, biggest_surprise: { ...wpi.latest_result.biggest_surprise, reaction_from: "typed" } } };
  const t2 = text(Y.build({ loc: WI, mode: "wpi", basis, prices, progress, wpi: typed, now: NOW }));
  assert.doesNotMatch(t2, /WASDE/);
  assert.match(t2, /break-even/);
});

test("component: no em dashes, under 5 KB gzipped, reads storage only", () => {
  assert.doesNotMatch(SRC, /—/);
  assert.ok(gzipSync(SRC).length < 5120, "gzip " + gzipSync(SRC).length);
  assert.doesNotMatch(SRC, /setItem|sendBeacon|gtag\(|method:\s*'POST'/);
});

const PAGES = [
  ["cot.html", "cot", 'id="cot-verdict-banner"'],
  ["scorecard.html", "scorecard", 'id="pb-latest"'],
  ["whats-priced-in.html", "wpi", "<!-- /PRERENDER:wp-farmbox -->"],
  ["daily.html", "daily", 'id="dv3-today"'],
];
for (const [f, mode, after] of PAGES) {
  test(f + ": one box after the main answer, with its script", () => {
    const h = readFileSync(ROOT + f, "utf8");
    assert.equal((h.match(/data-your-area=/g) || []).length, 1);
    const at = h.indexOf('data-your-area="' + mode + '"');
    assert.ok(at > 0);
    assert.ok(at > h.indexOf(after), "after " + after);
    assert.match(h, /<script src="\/components\/your-area\.js\?v=\d+" defer><\/script>/);
  });
}

test("every daily issue page and the generator template carry the box", () => {
  const files = readdirSync(ROOT + "daily").filter((f) => /^\d{4}-\d\d-\d\d\.html$/.test(f));
  assert.ok(files.length > 200);
  for (const f of files) {
    const h = readFileSync(ROOT + "daily/" + f, "utf8");
    assert.equal((h.match(/data-your-area="daily"/g) || []).length, 1, f);
    assert.ok(h.indexOf("data-your-area") > h.indexOf("</header>"), f + ": after the lead");
    assert.match(h, /your-area\.js\?v=\d+" defer/, f);
  }
  const py = readFileSync(ROOT + "scripts/generate_daily.py", "utf8");
  assert.match(py, /\{sparks_html\}\n {4}<aside class="ya" data-your-area="daily" hidden><\/aside>\n {4}\{topbar_html\}/);
  assert.match(py, /your-area\.js\?v=\d+" defer/);
});
