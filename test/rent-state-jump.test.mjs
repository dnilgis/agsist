/* Phone audit, Oct 19, 2026: on /rent/minnesota the county table (what
 * "cash rents by county" searchers came for) starts about 2,800 px down, after
 * the hero, tiles and calculator. A "County table" link now sits under the H1
 * and lands on the table's heading. The page order is unchanged (Sig's call).
 *
 *   node --test test/rent-state-jump.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("/rent/minnesota: a County table link right under the H1 lands on the county table heading", () => {
  const h = read("rent/minnesota.html");
  const h1 = h.indexOf("<h1>Minnesota Cash Rent by County, ");
  assert.ok(h1 > 0);
  const after = h.slice(h.indexOf("</h1>", h1) + 5).trimStart();
  assert.match(after, /^<p class="rs-jump"[^>]*><a href="#counties"[^>]*>County table &darr;<\/a><\/p>/);
  assert.equal((h.match(/id="counties"/g) || []).length, 1, "one target");
  const tgt = h.indexOf('<h2 id="counties"');
  assert.ok(tgt > h1, "target found");
  assert.match(h.slice(tgt, tgt + 120), /Every published county, 20\d\d<\/h2>/);
  assert.ok(h.indexOf('<table', tgt) > tgt, "the county table follows its heading");
  // order unchanged: hero tiles and the ground panel still come before the table
  assert.ok(h.indexOf('class="rs-hero"') < tgt);
});

test("every state rent page carries the link and its one target; the hub does not", () => {
  const pages = readdirSync(join(ROOT, "rent")).filter((f) => f.endsWith(".html") && f !== "index.html");
  assert.ok(pages.length >= 47, pages.length + " state pages");
  for (const f of pages) {
    const h = read("rent/" + f);
    assert.match(h, /<\/h1>\s*<p class="rs-jump"[^>]*><a href="#counties"/, f);
    assert.equal((h.match(/id="counties"/g) || []).length, 1, f);
  }
  assert.doesNotMatch(read("rent/index.html"), /rs-jump/);
});
