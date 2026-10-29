/* PRF basis risk and backtest, one line by the answer (benchmark and defense review, Oct 29, 2026):
 * the grid's rain is not the ranch's rain, and what past years would have paid is not a promise.
 * The longer note stays in "What PRF does not do", which the line links to.
 *   node --test test/prf-basis-line.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const LINE = '<p class="prf-fine prf-basis">Paid on the grid&rsquo;s rain, not your ranch&rsquo;s: a dry pasture can go unpaid and a wet one can be paid. What past years would have paid is history, not a promise for next year. <a href="#prf-not">What PRF does not do</a></p>';

test("the line sits right under the answer, in the builder and the built page", () => {
  for (const f of ["scripts/make_prf_html.py", "prf.html"]) {
    const h = read(f);
    assert.equal(h.split(LINE).length, 2, f + ": once");
    assert.ok(h.indexOf('id="prf-pm"') < h.indexOf(LINE) && h.indexOf(LINE) < h.indexOf('class="prf-win"'), f + ": under the answer");
  }
  const h = read("prf.html");
  assert.match(h, /<h2 id="prf-not">What PRF does not do<\/h2>/, "the link has its target");
  assert.match(h, /Your own gauge does not count/, "the longer note stays");
});
