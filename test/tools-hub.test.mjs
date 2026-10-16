/* /tools, from the Oct 15 review: the groups and cards run in order of what
 * people open (data/site-usage.json, 90-day page views), "Sell now or store?"
 * has a card, and nothing on a card calls delayed or hours-old prices live. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "tools.html"), "utf8");

function groups() {
  const out = [];
  const re = /<div class="cat-label">([^<]+)<\/div>\s*<div class="tools-grid">([\s\S]*?)\n    <\/div>/g;
  let m;
  while ((m = re.exec(html))) out.push({ label: m[1], hrefs: [...m[2].matchAll(/<a href="([^"]+)" class="tool-card">/g)].map((x) => x[1]) });
  return out;
}

test("tools hub has a Sell now or store? card", () => {
  assert.ok(groups().some((g) => g.hrefs.includes("/store-or-sell")));
  assert.match(html, /<div class="name">Sell now or store\?<\/div>/);
});

test("tool groups and the cards in each run by 90-day views, new pages last", () => {
  // Pinned to the Oct 10, 2026 usage file, so a data refresh never fails the
  // build; re-sort by hand when the numbers move a lot. Views then: money
  // 9,872 (cash bids 9,493), crop tracking 3,100, markets 2,114 without the
  // homepage, reference 1,773, spray and fertilizer 1,200, bins 422.
  assert.deepEqual(groups().map((g) => g.hrefs), [
    ["/cash-bids", "/breakeven", "/arc-plc", "/prf", "/store-or-sell", "/lrp", "/commodity-loan"],
    ["/hail-map", "/gdu-calculator", "/field-scout", "/planting-date"],
    ["/usda-calendar", "/tariffs", "/", "/hay-prices", "/cattle-auction-prices"],
    ["/usda-quick-stats", "/yield-estimator", "/fast-facts", "/data-sources"],
    ["/spray", "/fertilizer", "/urea", "/manure-value", "/nutrient-removal"],
    ["/grain-bin-calculator", "/grain-emc", "/grain-shrink", "/combine-loss"],
  ]);
});

test("no tool card calls delayed futures or posted bids live", () => {
  const cards = [...html.matchAll(/<a href="[^"]+" class="tool-card">([\s\S]*?)<\/a>/g)].map((m) => m[1]).join("\n");
  assert.ok(!/\bLive\b/i.test(cards), "a card still says live");
  assert.match(cards, /each with how long ago it was posted/);
});

test("in Oct and Nov the grain storage group moves ahead of crop tracking on the page", async () => {
  const m = html.match(/<script>\(function\(\)\{var m=new Date\(\)\.getMonth\(\);if\(m!==9&&m!==10\)return;[\s\S]*?<\/script>/);
  assert.ok(m, "the seasonal reorder script is on the page");
  // run it against the page's own groups with the clock on Oct 16 and Jul 16
  const vm = await import("node:vm");
  for (const [iso, want] of [["2026-10-16T15:00:00Z", ["Selling, costs and programs", "Grain storage", "Crop tracking"]], ["2026-07-16T15:00:00Z", ["Selling, costs and programs", "Crop tracking"]]]) {
    const labels = groups().map((g) => ({ textContent: g.label, grid: { label: g.label } }));
    const order = [];
    labels.forEach((l) => order.push(l, l.grid));
    const parent = { insertBefore(a, b) { order.splice(order.indexOf(a), 1); order.splice(order.indexOf(b), 0, a); } };
    labels.forEach((l) => { l.parentNode = parent; Object.defineProperty(l, "nextElementSibling", { get: () => order[order.indexOf(l) + 1] }); });
    const T = Date.parse(iso);
    class D extends Date { constructor(...a) { super(...(a.length ? a : [T])); } }
    vm.runInNewContext(m[0].replace(/^<script>|<\/script>$/g, ""), { Date: D, document: { querySelectorAll: () => labels } });
    const seq = order.filter((x) => x.textContent).map((x) => x.textContent);
    assert.deepEqual(seq.slice(0, want.length), want, iso);
    assert.equal(order.length, labels.length * 2);
    for (const l of labels) assert.equal(order[order.indexOf(l) + 1], l.grid, "each label keeps its grid");
  }
});
