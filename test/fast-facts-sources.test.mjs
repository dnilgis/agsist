/* Fast Facts numbers checked against the documents themselves (references
 * branch copies read Oct 15, 2026), not search snippets.
 *
 *   Corn rootworm adults at silking: 5+ beetles per plant in the first week of
 *     pollen shed, or silks clipped to 1/2 in on 25-50% of plants (SDSU
 *     Extension). 0.75 beetles per plant is the UW L023 number for whether
 *     next year's corn on corn needs rootworm protection, not a spray trigger.
 *   Soybean aphid: 250 per plant, more than 80% of plants, rising, through R5;
 *     no threshold for R6 (UMN Extension, Scouting for soybean aphid).
 *   K-Mag: 0-0-22, 22% S, 10.8% Mg guaranteed (2025 K-Mag Granular data sheet).
 *
 *   node --test test/fast-facts-sources.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "fast-facts.html"), "utf8");
const js = readFileSync(join(ROOT, "components/fast-facts.js"), "utf8");

test("corn rootworm adult threshold is the silking one, with 0.75 kept as next year's number", () => {
  const row = html.match(/<tr><td class="tl">Corn Rootworm \(adult\)<\/td>.*?<\/tr>/)[0];
  assert.ok(row.includes("5 or more beetles per plant in the first week of pollen shed"), row);
  assert.ok(row.includes('silks clipped to 1/2" on 25&ndash;50% of plants'), row);
  assert.ok(row.includes("It is not a spray trigger"), row);
  for (const src of [html, js]) {
    assert.ok(!/0\.75 beetles(\/| per )plant \+/.test(src), "0.75/plant printed as a silking threshold");
    assert.ok(!/threshold: 0\.75\/plant/.test(src));
  }
  // 2026-10-16: the stage-picker scouting list (unsourced rows like "3+ cut
  // plants per 100" and "8% egg mass") is gone from fast-facts.js; the
  // threshold table in the HTML is the one copy, so the script carries none.
  assert.ok(!/beetles\/plant|cut plants|egg mass|defoliation|stippling/.test(js), "a threshold copy in fast-facts.js");
  assert.ok(html.includes("https://extension.sdstate.edu/monitor-your-corn-corn-rootworm-adults-inform-management-next-year-and-avoid-substantial-silk"));
  assert.ok(html.includes("https://corn.aae.wisc.edu/Management/pdfs/L023_CornIPM_insect.pdf"));
});

test("Japanese beetle in corn: silks clipped under 1 inch (Iowa State)", () => {
  assert.ok(html.includes('3+ beetles/ear, silks clipped under 1", pollination not done'));
  assert.ok(!/silk &lt;1\/2" with poor pollination/.test(html));
  assert.ok(!/3\/ear \+ silk <1\/2"/.test(js));
});

test("soybean aphid threshold runs through R5, timing and FAQ agree", () => {
  const row = html.match(/<tr><td class="tl">Soybean Aphid<\/td>.*?<\/tr>/)[0];
  assert.ok(row.includes("250 aphids/plant average, on more than 80% of plants, increasing"), row);
  assert.ok(row.includes('<td class="tl">Through R5</td>'), row);
  assert.ok(!row.includes("V4&ndash;R5"));
  assert.ok(!row.includes("Count 20 plants"), "20 plants is not in the UMN guide");
  const faq = "250 aphids per plant on average, aphids on more than 80% of plants, and the population rising. That threshold runs through R5. University of Minnesota Extension sets no threshold for R6.";
  assert.equal(html.split(faq).length - 1, 2, "FAQ answer in JSON-LD and visible, word for word");
  assert.ok(!/before R5 growth stage/.test(html));
  assert.ok(!/Do NOT treat (aphid )?after R5/.test(js));
  assert.ok(!/80%\+ of plants/.test(js));
  assert.ok(html.includes("https://extension.umn.edu/soybean-pest-management/scouting-soybean-aphid"));
});

/* 2026-10-15: K-Mag lost its price (the hand-typed dealer sheet that carried
 * it is gone and no live source prices it), so its pill and the price-file
 * check went with it. Its analysis is still printed in the reference table
 * and must stay right; and no K-Mag price may come back without a source. */
test("K-Mag is 0-0-22 with 22% S and 10.8% Mg where it is printed, and is never priced", () => {
  assert.ok(!/\bkmag\b|K-Mag Premium/i.test(js), "fast-facts.js prices K-Mag again");
  const fert = JSON.parse(readFileSync(join(ROOT, "data/fertilizer-prices.json"), "utf8"));
  assert.ok(!fert.prices.some((p) => /k-?mag/i.test(p.name)), "a K-Mag price in the shared file");
  assert.ok(html.includes('<td class="tl">K-Mag (0-0-22)</td><td class="ze">0</td><td class="ze">0</td><td class="hi">22</td><td>22% S, 10.8% Mg</td>'));
  assert.ok(html.includes("https://cropnutrition.com/wp-content/uploads/2024/04/2025_K-Mag_Granular_Data_Sheet.pdf"));
});
