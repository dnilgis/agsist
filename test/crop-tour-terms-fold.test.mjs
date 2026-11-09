/* Curtain round 2 (Nov 9): the crop tour page keeps its sources, the "what counts as final" line, the NASS and
 * WASDE credits and the not-affiliated line in one closed "Sources and terms" fold at the bottom, and prints no
 * backtest or pipeline wording. node --test test/crop-tour-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const h = readFileSync(ROOT + "crop-tour.html", "utf8");
const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const BANNED = /80th percentile|backtest|recomputed every run|history file|source defect|Arithmetic is ours|Every cell sourced|Where the numbers came from|\.json|\.py\b|\.yml|workflow/i;

test("one closed Sources and terms fold, the last fold on the page, notices inside", () => {
  const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
  assert.equal(folds.length, 1);
  assert.ok(!/\sopen[\s>]/.test(folds[0]), "closed");
  const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
  const fold = main.slice(i, e);
  assert.ok(!/<details/.test(main.slice(e + 10)), "no fold after it");
  assert.ok(!/<h2|<section|ct-note|data-signup-ask/.test(main.slice(e + 10)), "only the byline follows");
  assert.match(fold, /not affiliated with Pro Farmer or Farm Journal/);
  assert.match(fold, /USDA NASS Crop Production Annual Summary/);
  assert.match(fold, /WASDE/);
  assert.match(fold, /final yield used here/);
  assert.ok(fold.includes("<!-- CT:sources -->") && fold.includes("<!-- /CT:sources -->"), "the baked source list lives inside the fold");
  assert.ok(!main.slice(0, i).includes("not affiliated with Pro Farmer"), "said once, in the fold");
  assert.ok(!/<b>Sources\.<\/b>/.test(main.slice(0, i)), "no open sources block above it");
});

test("the how-to-use box and our own call stay in the reading path; no backtest or pipeline wording anywhere", () => {
  assert.ok(main.includes("<b>How to use this.</b>") && main.includes("<b>Our own number is on the record too.</b>"));
  const text = main.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
  const m = text.match(BANNED);
  assert.equal(m, null, m && m[0]);
});
