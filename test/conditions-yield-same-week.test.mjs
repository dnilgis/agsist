/* /conditions-yield: the research sentence and the state map read the same week.
 *
 * Oct 17, 2026 (audit N12): the baked sentence said week 40 ratings explain 36%
 * for Iowa while the map, reading week 41 from the same fit.json, said "no fit
 * this week" for every state. Week 41 has under 15 paired years. Now both use
 * the newest week with a fit (scripts/build_condyield.py fit_week and the page's
 * buildVerdicts) and say which week it is.
 *
 *   node --test test/conditions-yield-same-week.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(ROOT + "conditions-yield.html", "utf8");
const fit = JSON.parse(readFileSync(ROOT + "data/cond-yield/fit.json", "utf8"));

function verdicts(j) {
  const m = html.match(/function buildVerdicts\(j\)\{[\s\S]*?\n    return out;\n  \}/);
  assert.ok(m, "buildVerdicts not found");
  const ctx = { __A2F: { IA: "Iowa", IL: "Illinois" } };
  vm.createContext(ctx);
  vm.runInContext(m[0] + "\nthis.f = buildVerdicts;", ctx);
  return ctx.f(j);
}

test("the seed sentence and the map give Iowa the same week and percent", () => {
  const seed = html.match(/<!--SEED:cystats-->([\s\S]*?)<!--\/SEED-->/)[1];
  const wk = +seed.match(/^week (\d+) of/)[1];
  const pct = +seed.match(/(\d+)% of how Iowa/)[1];
  const ia = verdicts(fit).IA;
  assert.equal(ia.big, pct + "%");
  if (ia.late) assert.equal(ia.fw, wk);
  else assert.equal(+fit.crops.corn.states.IA.latest.week, wk);
});

test("a week with no fit falls back to the last fitted week and says so (hand-made data)", () => {
  const j = { min_n: 15, crops: { corn: { states: { IA: { latest: { year: 2026, week: 41 },
    weeks: { 39: { r2: 0.641, n: 26 }, 40: { r2: 0.357, n: 22 } } } } } } };
  const v = verdicts(j).IA;
  assert.equal(v.big, "36%");
  assert.match(v.sent, /^Week 40’s corn rating \(the last week with a fit; week 41 has under 15 paired years\)/);
  assert.doesNotMatch(v.sent, /no fit this week/);
  const now = verdicts({ min_n: 15, crops: { corn: { states: { IA: { latest: { year: 2026, week: 40 },
    weeks: { 39: { r2: 0.641, n: 26 }, 40: { r2: 0.357, n: 22 } } } } } } }).IA;
  assert.match(now.sent, /^This week’s corn rating has explained/);
});
