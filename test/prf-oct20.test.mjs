/* PRF fixes Sig approved on Oct 20, 2026, each from a real case on /prf?g=14538 (Henderson County, TX)
 * at 390 px: step 2 open was 9,021 px tall with the productivity factor at y 10,527; the plain
 * "What this means" line printed but never showed; the sponsor ask and the email box sat above the answer.
 *   node --test test/prf-oct20.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const H = read("prf.html");
const setup = H.slice(H.indexOf('id="prf-setup"'), H.indexOf('id="prf-answer-h"'));

test("step 2 holds the inputs only: acres, coverage, productivity factor, then months", () => {
  for (const id of ['id="prf-acres"', 'id="prf-cov"', 'id="prf-pf"', 'id="prf-iv-body"']) assert.ok(setup.includes(id), id + " in step 2");
  assert.ok(setup.indexOf('id="prf-cov"') < setup.indexOf('id="prf-pf"') && setup.indexOf('id="prf-pf"') < setup.indexOf('id="prf-iv-body"'), "productivity factor beside coverage, before the months");
  assert.ok(!setup.includes('id="prf-outlook"') && !setup.includes('id="prf-now"'), "the outlook and the interval so far are out of step 2");
});

test("the outlook and the interval so far are folded rows at the top of step 4", () => {
  const det = H.slice(H.indexOf('id="prf-det-h"'));
  const now = det.indexOf('<details class="prf-d" id="prf-now-d" hidden>'), out = det.indexOf('<details class="prf-d" id="prf-outlook-d" hidden>');
  assert.ok(now > 0 && out > now && out < det.indexOf('id="prf-years-d"'), "two rows before every-year");
  assert.ok(det.slice(now, out).includes('id="prf-now"') && det.slice(out, det.indexOf('id="prf-years-d"')).includes('id="prf-outlook"'));
  /* each row shows only when its panel does */
  assert.match(read("components/prf-now.js"), /closest\('details\.prf-d'\)[\s\S]*if \(row\) row\.hidden = false/);
  assert.match(read("components/prf-outlook.js"), /closest\('details\.prf-d'\)[\s\S]*if \(row\) row\.hidden = false[\s\S]*if \(row\) row\.hidden = true/);
});

test("the plain line sits under the answer and shows on screen", () => {
  const a = H.indexOf('<div class="prf-answer" id="prf-answer"></div>'), pm = H.indexOf('<p class="prf-pm" id="prf-pm"></p>');
  assert.ok(a > 0 && pm > a && pm - a < 80, "right under the figures");
  const css = read("components/prf.css").split("@media print")[0];
  assert.match(css, /\.prf-pm \{ margin: 1rem 0 0;/);
});
