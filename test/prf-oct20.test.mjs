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

test("index so far: the rain-needed table first, the definition under the number; a final interval says what each level pays", async () => {
  const N = (await import("../components/prf-now.js")).default;
  /* the real case: grid 14538, July to August 2026, both months NCEI final, 3.17 in of a 4.87 in average, index 65.0 */
  assert.equal(N.payShare(65.0, 90), 28);
  assert.equal(N.payShare(65.0, 70), 7);
  assert.equal(N.payShare(95, 90), 0);
  const fin = { name: "Jul-Aug", long: "July to August", y: 2026, ended: true, allFinal: true, to: "2026-08-31", how: [["July", "final"], ["August", "final"]], index: 65.0, precipIn: 3.17, avgIn: 4.87 };
  const html = N.render({ state: "ok", through: "2026-10-15", ivs: [fin], acc: null });
  assert.match(html, /a 90% policy pays 28% of its protection for Jul-Aug; 85% pays 24%, 80% pays 19%, 75% pays 13%, 70% pays 7%\./);
  assert.match(html, /a 2026 policy is paid on its own year&rsquo;s index/);
  assert.ok(html.indexOf("pn-figs") < html.indexOf("pn-def") && html.indexOf("pn-def") < html.indexOf("pn-pay"), "number, then what it means, then what it pays");
  const est = Object.assign({}, fin, { allFinal: false });
  assert.ok(!/pn-pay/.test(N.render({ state: "ok", through: "2026-10-15", ivs: [est], acc: null })), "no payout line on an estimate");
  /* an open interval: Sep-Oct 2026, 4.82 in so far of 7.85 */
  const open = { name: "Sep-Oct", long: "September to October", y: 2026, ended: false, days: 61, left: 16, to: "2026-10-31", how: [["September", "initial"], ["October", "daily"]], index: 61.4, precipIn: 4.82, avgIn: 7.85,
    need: [70, 75, 80, 85, 90].map((c) => ({ cov: c, mm: 1, inches: 1 })) };
  const o = N.render({ state: "ok", through: "2026-10-15", ivs: [open], acc: null });
  assert.ok(o.indexOf("pn-need") < o.indexOf("pn-figs"), "leads with the more-rain table");
  const def = o.slice(o.indexOf("pn-def"));
  assert.ok(o.indexOf("pn-figs") < o.indexOf("pn-def") && /percent of normal/.test(def) && /climbs as the rest of the interval&rsquo;s rain comes in/.test(def), "defined right under the number");
  assert.ok(!/pn-pay/.test(o));
});
