/* CLS sweep, Nov 10, 2026 (part b): /breakeven, /store-or-sell, /grain-shrink, /manure-value.
 * Sum of layout shifts before -> after, max of 390 and 1280, plain and saved (Chetek WI 54728):
 *   /breakeven       0.174 -> 0.006  the answer card's lines, the crop-year buttons, the board bar and the next-crop note came in late
 *   /store-or-sell   0.122 -> 0.000  the answer card grew 341 px when the bids landed
 *   /grain-shrink    0.113 -> 0.006  1280: the answer grew 175 px and the wet-side boxes were shown by the script
 *   /manure-value    0.079 -> 0.000  saved: the local prices rewrote the answer's text and its line count
 * Harness and throttling: test/cls-sweep-lib.mjs.
 *
 *   node --test test/cls-sweep-b.test.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { read, skip, MODES, open } from "./cls-sweep-lib.mjs";

const LIMIT = 0.04;
const PAGES = ["/breakeven", "/store-or-sell", "/grain-shrink", "/manure-value"];

test("the holds are in the pages", () => {
  const B = read("breakeven.html"), S = read("store-or-sell.html"), G = read("grain-shrink.html"), M = read("manure-value.html");
  assert.match(B, /\.be-ans\{min-height:\d+px\}/, "break-even: the answer card holds its height");
  assert.match(B, /class="be-yr2 be-yr2-wait"/, "break-even: the crop-year row starts held");
  assert.match(B, /class="live-price-bar live-wait"/, "break-even: the board bar starts held");
  const BJ = read("components/breakeven.js");
  assert.match(BJ, /y2\.classList\.remove\('be-yr2-wait'\)/, "break-even: syncYearSelect lets go of the row");
  assert.match(BJ, /\.catch\(function \(\) \{ letGoBar\(\); \}\)/, "break-even: a failed price file lets go of the bar too");
  assert.match(S, /\.sos-card\{min-height:\d+px\}/, "store or sell: the answer card holds its height");
  assert.match(G, /\.gs-answer\{min-height:\d+px\}/, "grain shrink: the answer holds its height");
  assert.match(G, /setAttribute\('data-gs','wet'\)/, "grain shrink: the wet side shows before paint");
  assert.match(M, /classList\.add\('mv-wait'\)/, "manure: a saved reader's answer is held before paint");
  assert.match(M, /setTimeout\(function\(\)\{document\.documentElement\.classList\.remove\('mv-wait'\)\},8000\)/, "manure: the hold never outlives a script that did not load");
  assert.equal((read("components/manure-value.js").match(/classList\.remove\('mv-wait'\)/g) || []).length, 2, "manure: both ends of the price load let go");
});

let h = null;
before(async () => { if (!skip) h = await open(); });
after(async () => { if (h) await h.close(); });
for (const p of PAGES) for (const [w, saved] of MODES) {
  test(`${p} at ${w}px, ${saved ? "saved ZIP 54728" : "nothing saved"}: layout shift under ${LIMIT}`, { skip, timeout: 90000 }, async () => {
    const r = await h.cls(p, w, saved);
    assert.ok(r.cls < LIMIT, `layout shift ${r.cls.toFixed(4)}: ${r.who.join(" | ")}`);
  });
}
