/* Site search (components/search.js) against the committed index files.
 *
 * The shipped search.js is run in a bare context (no document), which loads
 * only its matching code, and searches data/search-index.json plus
 * data/search-elevators.json, so a green run checks what a reader gets.
 *
 *   node --test test/search.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/search.js", "utf8"), ctx);
const S = ctx.window.AgsistSearch;

const main = readFileSync(ROOT + "data/search-index.json");
const elev = readFileSync(ROOT + "data/search-elevators.json");
const items = S._prep(JSON.parse(main).items).concat(
  S._prep(JSON.parse(elev).items).map((e) => ((e.i += 100000), e)));
const top = (q, local = "") => S._search(items, q, local)[0]?.e.url;

test("the index stays small enough to load when search opens", () => {
  assert.ok(gzipSync(main).length < 150 * 1024, "search-index.json gzip");
  assert.ok(gzipSync(elev).length < 150 * 1024, "search-elevators.json gzip");
});

test("every result points at a page in this checkout", () => {
  for (const e of items) {
    const u = e.url.split("#")[0].split("?")[0].replace(/^\//, "");
    const f = u === "" ? "index.html" : u.endsWith("/") ? u + "index.html" : u + ".html";
    assert.ok(existsSync(ROOT + f), `${e.title} -> ${e.url}`);
  }
});

test("no price or other figure is printed in a result title", () => {
  for (const e of items.filter((x) => x.type <= 3)) assert.doesNotMatch(e.title, /\$|\d+%|\bbu\b/, e.title);
});

test("the searches a farmer types land on the right page", () => {
  assert.equal(top("bloomer"), "/cash-bids/wisconsin/bloomer");
  assert.equal(top("Bloomer WI"), "/cash-bids/wisconsin/bloomer");
  assert.equal(top("dunn county wi"), "/farmland-atlas/wisconsin/dunn-county");
  assert.equal(top("dunn county", "WI"), "/farmland-atlas/wisconsin/dunn-county");
  assert.equal(top("dunn county", "ND"), "/farmland-atlas/north-dakota/dunn-county");
  assert.equal(top("cash rent iowa"), "/rent/iowa");
  assert.equal(top("rent"), "/rent/");
  assert.equal(top("spray"), "/spray");
  assert.equal(top("beans"), "/soybean-futures-prices");
  assert.equal(top("soyben"), "/soybean-futures-prices");
  // A typo still finds Chippewa Falls: its town page when one is built, or its
  // ZIP search while no board there is fresh enough for a town page.
  assert.match(top("chipewa falls"), /\/cash-bids\/wisconsin\/chippewa-falls$|\/cash-bids\?zip=5472\d$/);
  assert.equal(top("iowa hail"), "/hail-map/iowa");
});

test("small typos match; unrelated words do not", () => {
  assert.equal(S._ed("soyben", "soybean", 1), 1);
  assert.equal(S._ed("cron", "corn", 1), 1);
  assert.equal(S._search(items, "zzzzqx", "").length, 0);
});

/* ---- navfix1 (Oct 18): ZIP, filler words, dairy, towns with no page ---- */
const placesRaw = readFileSync(ROOT + "data/search-places.json");
const all = items.concat(S._prep(JSON.parse(placesRaw).items).map((e) => ((e.i += 200000), e)));
const urls = (q, n = 2) => Array.from(S._search(all, q, "WI").slice(0, n), (h) => h.e.url);

test("a 5-digit ZIP goes straight to the live bid search for that ZIP", () => {
  assert.equal(urls("54728", 1)[0], "/cash-bids?zip=54728");
  assert.equal(urls(" 50010 ", 1)[0], "/cash-bids?zip=50010");
  assert.equal(urls("zip 54728", 1)[0], "/cash-bids?zip=54728");
  assert.equal(urls("cash bids 54728", 1)[0], "/cash-bids?zip=54728");
  assert.equal(S._search(all, "5472", "WI").length, 0, "four digits is not a ZIP yet");
  // the route reads ?zip= and runs the search on load
  const cb = readFileSync(ROOT + "components/cash-bids.js", "utf8");
  assert.match(cb, /var z=p\.get\('zip'\)[\s\S]{0,200}\/\^\\d\{5\}\$\/\.test\(z\)[\s\S]{0,200}doSearch\(z\)/);
});

test("'near me', 'today', 'price(s)' and 'local' are dropped; a grain page comes first, cash bids second", () => {
  assert.deepEqual(urls("corn prices near me"), ["/corn-futures-prices", "/cash-bids"]);
  assert.deepEqual(urls("corn price today"), ["/corn-futures-prices", "/cash-bids"]);
  assert.deepEqual(urls("soybean prices"), ["/soybean-futures-prices", "/cash-bids"]);
  assert.deepEqual(urls("local wheat price"), ["/wheat-futures-prices", "/cash-bids"]);
  // a plain crop word is unchanged, and a filler word alone still searches
  assert.equal(urls("corn", 1)[0], "/corn-futures-prices");
  assert.ok(S._search(all, "prices", "WI").length > 0);
  assert.equal(urls("milk prices", 1)[0], "/milk-prices");
});

test("'dairy' puts Milk prices first, ahead of Daily and a co-op named Dairy", () => {
  assert.equal(urls("dairy", 1)[0], "/milk-prices");
});

test("a town with no page of its own finds the nearest town page", () => {
  assert.ok(gzipSync(placesRaw).length < 100 * 1024, "search-places.json gzip");
  const hit = S._search(all, "chetek", "WI")[0];
  assert.equal(hit.e.type, 6);
  assert.equal(hit.e.title, "Chetek, WI");
  assert.match(hit.e.url, /^\/cash-bids\/wisconsin\/[a-z-]+$/);
  assert.match(hit.e.sub, /^Nearest town with bids: [A-Z][A-Za-z .'-]+, WI$/);
  const places = JSON.parse(placesRaw).items;
  const pageTowns = new Set(items.filter((e) => e.type === 2).map((e) => e.title.toLowerCase()));
  for (const p of places) {
    assert.equal(p[0], 6);
    assert.ok(!pageTowns.has(p[1].toLowerCase()), `${p[1]} has its own page`);
    assert.doesNotMatch(p[2], /\d/, "no distance or number in the line");
  }
  // a town that has a page still lands on its own page first
  assert.equal(urls("bloomer", 1)[0], "/cash-bids/wisconsin/bloomer");
});

test("zero-result searches are counted without the words", () => {
  const js = readFileSync(ROOT + "components/search.js", "utf8");
  const fn = js.slice(js.indexOf("function countNoMatch"), js.indexOf("function setActive"));
  assert.match(fn, /gtag\('event', 'search_no_match'/);
  assert.doesNotMatch(fn, /localStorage|sessionStorage|search_term|\bq:|query:/, "no query text sent or stored");
  assert.match(fn, /query_length: qn\.length, query_words/);
});
