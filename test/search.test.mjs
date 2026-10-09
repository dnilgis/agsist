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
  assert.equal(top("rent"), "/cash-rent");
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
