/* Curtain round 2 (Nov 9): the grain bin calculator no longer prints its formulas. The calculator still computes (test/grain-bin.test.mjs
 * holds the arithmetic); the page keeps inputs, outputs and one line on how to read them, and its sources and assumptions sit in one
 * closed "Sources and terms" fold at the bottom.   node --test test/grain-bin-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const h = readFileSync(ROOT + "grain-bin-calculator.html", "utf8");
const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const noScripts = (t) => t.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
const FAQ = /<h2>Common Questions<\/h2>\s*<dl class="faq-grid">[\s\S]*?<\/dl>/;   // the questions are search text and are left alone

test("one closed Sources and terms fold, with the assumptions and the dealer sources inside", () => {
  const f = main.match(/<details class="src-fold"><summary><h2>Sources and terms<\/h2><\/summary>/g) || [];
  assert.equal(f.length, 1);
  assert.equal((main.match(/Sources and terms/g) || []).length, 1);
  const i = main.indexOf(f[0]), fold = main.slice(i, main.indexOf("</details>", i));
  assert.match(fold, /The calculator is an estimate from the sizes you enter, not a scale ticket/);
  assert.match(fold, /The plain setting counts a level fill with a modest peak and no pack/);
  assert.match(fold, /Values are estimates, not financial advice/);
  assert.match(fold, /28 degree angle of repose and 6% compaction factor/);
  assert.match(fold, /Purdue Extension NCH-61/);
  assert.ok(main.indexOf("</details>", i) > main.indexOf("Common Questions"), "below the questions");
});

test("no formula text in the reading path: the box is one line on how to read the result", () => {
  const body = noScripts(main).replace(FAQ, "").replace(/<details class="src-fold">[\s\S]*?<\/details>/, "");   // the unit definition stays in the fold
  const m = body.match(/&pi;|r&sup2;|0\.8036|tan\s?(25|&theta;)|Cylinder =|Peaked cone =|Hopper cone =|Shrink % =|Dry Bu =|Drying Cost =|100 &divide; \(100|1\.2445|Formulas Used|formula/i);
  assert.equal(m, null, m && m[0]);
  assert.match(body, /<strong>How to read this<\/strong>/);
  assert.match(body, /Bin bushels are what the bin holds as grain; market bushels adjust that to your test weight; net value is after shrink and drying/);
});

test("the page still gives the worked numbers a reader checks", () => {
  const t = noScripts(main).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(t, /A 30 ft bin holds about 568 bu per foot, so 1 inch of grain is about 47 bu/);
  assert.match(t, /36 ft bin is about 818 bu per foot and a 48 ft bin about 1,454/);
  assert.match(t, /a chart reads about 5 to 6\.5% higher for the same bin/);
  assert.match(t, /shrinks 3\.5%, 105 bushels on 3,000 bushels/);
});
