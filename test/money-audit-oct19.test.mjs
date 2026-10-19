/* Money audit fixes, Oct 19, 2026 (audit + adversary, night run). Each case is
 * the real page the audit read.
 *
 *   2. /arc-plc said sequestration "comes off before the limit"; no source in
 *      hand states the order (FR 2026-00313 and 7 CFR 1412 do not).
 *   3. 2026 wheat's price spread is borrowed from corn (its own changes
 *      stretched to corn's October SD) and most of its expected payment rides
 *      on it: Sumner Co., KS non-irrigated wheat printed $6.76 PLC vs $6.64
 *      ARC-CO ($1.56 PLC with no spread). The dollars are withheld with the
 *      reason; the call stays. "Mostly harvested, so a normal crop" is gone.
 *   4. The 2026 payment limit: $164,000 by the rule's own method, not "not out",
 *      and never called official.
 *   5. Nebraska's comparison "Combine corn" is the dryland line ($49.29, 42
 *      answers), not irrigated ($50.70); Missouri's G302 (April 2023) is 2022 rates.
 *   6. Iowa rent: -1.5% is the change in the state median ($270 to $266).
 *
 *   node --test test/money-audit-oct19.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const text = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&rsquo;/g, "’").replace(/&middot;/g, "\u00b7").replace(/&times;/g, "\u00d7").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("2: no claim about the order of sequestration and the payment limit", () => {
  const h = read("arc-plc.html");
  assert.doesNotMatch(h, /comes off before the limit/);
  assert.match(h, /Sequestration \(5\.7% on recent payments\) also comes off; ask your FSA office how it meets the limit for your farm\./);
});

test("3: Sumner Co., KS 2026 wheat keeps its call and prints no expected dollars, with the reason", () => {
  const h = read("arc-plc/kansas/sumner-county.html"), t = text(h);
  assert.match(t, /Wheat · non-irrigated Either one Close Too close to call\. Wheat has no October futures history of its own on file, so its price swings are borrowed from corn’s, and the expected dollars would rest on them\. We do not print them\./);
  assert.doesNotMatch(h, /\$6\.76|\$6\.64/, "the borrowed-spread dollars are gone from the page, FAQ and JSON-LD");
  assert.match(t, /Close, either one: too small or too uncertain to call \(PLC paid more in 3 of 11 past-year scenarios, ARC-CO in 3; no dollar figure, because the price swings are borrowed from corn’s\)/);
  // what does not rest on the spread stays: the PLC price line and the trigger yield
  assert.match(t, /PLC only pays if wheat averages under \$6\.35 a bushel for 2026\./);
  assert.match(t, /ARC-CO pays here for 2026 if the county yield comes in under 43 bu at USDA’s price outlook, \$6\.30\./);
  // a crop on its own spread still prints dollars (Story Co., IA oats)
  assert.match(text(read("arc-plc/iowa/story-county.html")), /comes out about \$\d+ more per base acre/);
});

test("3: only 2026 wheat is marked, and the browser's words drop the dollars on that mark", () => {
  const D = JSON.parse(read("data/arc-plc.json"));
  assert.equal(D.years["2026"].crops.wheat.scen.nousd, true);
  for (const k of ["corn", "soybeans"]) assert.ok(!D.years["2026"].crops[k].scen.nousd, k);
  const ctx = { window: {} };
  for (const f of ["components/arc-plc.js", "components/arc-plc-math.js"]) vm.runInNewContext(read(f), ctx);
  const M = ctx.window.AgArcMath;
  // [verdict, PLC cents, ARC cents, PLC wins, ARC wins, n, |gap| cents, years ARC paid, flags (1 borrowed, 4 under $1, 8 nousd), whole]
  const v = M.unpack(["close", 676, 664, 3, 3, 11, 12, 6, 1 | 4 | 8, 0]);
  const line = M.verdictLine(v, { min_scen: 8 });
  assert.equal(line, "Close, either one: too small or too uncertain to call (PLC paid more in 3 of 11 past-year scenarios, ARC-CO in 3; no dollar figure, because the price swings are borrowed from corn&rsquo;s).");
  assert.match(M.verdictLine(M.unpack(["close", 676, 664, 3, 3, 11, 12, 6, 1 | 4, 0]), { min_scen: 8 }), /expected \$6\.76 PLC vs \$6\.64 ARC-CO/, "without the mark the dollars print");
});

test("3: the 2026 yield line says county yields come later, not that a harvested crop is normal", () => {
  for (const f of ["arc-plc.html", "components/arc-plc.js", "components/arc-plc-math.js", "scripts/build_arc_plc.py"]) assert.doesNotMatch(read(f), /mostly harvested/, f);
  assert.match(read("arc-plc.html"), /USDA puts out county yields months after harvest, so until then every scenario year assumes a normal crop/);
});

test("4: the 2026 payment limit is the rule's own figure, not official and not 'not out'", () => {
  const h = read("arc-plc.html");
  assert.doesNotMatch(h, /2026 and 2027 figures are not out/);
  assert.match(h, /For 2026 it is \$164,000 by the rule(&#x27;|'|&rsquo;)s own method; FSA posts the official figure\./);
  assert.doesNotMatch(h, /official 2026 (payment )?limit of \$164,000/);
});

test("5: Nebraska compares on dryland corn; Missouri reads as 2022 rates", () => {
  const ne = JSON.parse(read("data/custom-rates/ne.json"));
  const c = ne.rows.filter((r) => r.k === "combine-corn");
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].o, c[0].a, c[0].n], ["Combining dryland corn, flat rate", 49.29, 42]);
  assert.ok(ne.rows.some((r) => r.o === "Combining irrigated corn, flat rate" && r.a === 50.7 && !r.k), "the irrigated line stays in the table");
  const h = read("custom-rates.html");
  assert.match(h, /<a href="\/custom-rates\/missouri">Missouri<\/a> <small>2022 rates<\/small>/);
  assert.match(h, /Missouri \$43\.29 \(2022 rates, 2023 survey, 17 answers\)/);
  assert.match(h, /Nebraska \$49\.29 \(2026 survey, 42 answers\)/);
  assert.doesNotMatch(h, /Nebraska \$50\.70/);
});

test("6: Iowa's -1.5% is said to be the state median's change", () => {
  const h = read("rent/iowa.html");
  assert.doesNotMatch(h, /vs 2025 \(matched counties\)/);
  assert.match(h, /state median -1\.5% vs 2025 \(same counties\), not a typical county&rsquo;s change/);
  assert.match(h, /Across the same 99 counties the state median went from \$270 to \$266, <b[^>]*>-1\.5&#37; vs 2025<\/b>: the change in the median, not in a typical county\./);
});
