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
    ["/cash-bids", "/breakeven", "/arc-plc", "/prf", "/store-or-sell", "/lrp"],
    ["/hail-map", "/gdu-calculator", "/field-scout", "/planting-date"],
    ["/usda-calendar", "/tariffs", "/", "/hay-prices"],
    ["/usda-quick-stats", "/yield-estimator", "/fast-facts", "/data-sources"],
    ["/spray", "/fertilizer", "/urea", "/manure-value", "/nutrient-removal"],
    ["/grain-bin-calculator", "/grain-emc", "/grain-shrink"],
  ]);
});

test("no tool card calls delayed futures or posted bids live", () => {
  const cards = [...html.matchAll(/<a href="[^"]+" class="tool-card">([\s\S]*?)<\/a>/g)].map((m) => m[1]).join("\n");
  assert.ok(!/\bLive\b/i.test(cards), "a card still says live");
  assert.match(cards, /each with how long ago it was posted/);
});
