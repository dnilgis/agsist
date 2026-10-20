/* /cot: the card's percentile pill and The Read print one number (2026-10-20, panel F3).
 * Soybeans sat at 89.8: The Read said "89th" (cot_analysis.shown_pct, which keeps a
 * not-crowded reading off the 90th crowded line) while the card pill rounded to "90th".
 * Both now use one rule: crowd.shown from the pipeline, or shownPct() with the same clamp.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const JS = read("components/cot-page.js");

function liftFn(src, name) {
  const i = src.indexOf("function " + name + "(");
  assert.ok(i >= 0, `components/cot-page.js no longer defines ${name}()`);
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) break;
  }
  return src.slice(i, j + 1);
}

function pillText(analysis, key) {
  const pill = { textContent: "", className: "" };
  const ctx = {
    CX_A: analysis,
    cxAligned: () => true,
    document: { getElementById: (id) => (id === "pctl-" + key ? pill : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(["shownPct", "ordinal", "cxCommodity", "renderInsight"].map((n) => liftFn(JS, n)).join("\n")
    + `\nrenderInsight(${JSON.stringify(key)});`, ctx);
  return pill.textContent;
}

function shown(p, crowded) {
  const ctx = {};
  vm.createContext(ctx);
  return vm.runInContext(liftFn(JS, "shownPct") + `\nshownPct(${p}, ${JSON.stringify(crowded)}, 90, 10);`, ctx);
}

test("the clamp: same cases as cot_analysis.shown_pct", () => {
  assert.equal(shown(89.8, null), 89, "not crowded 89.8 stays off the 90th");
  assert.equal(shown(90.2, "long"), 90);
  assert.equal(shown(10.2, null), 11, "not crowded 10.2 stays off the 10th");
  assert.equal(shown(9.6, "short"), 10);
  assert.equal(shown(99.7, "long"), 99, "never the 100th");
  assert.equal(shown(0.2, "short"), 1, "never the 0th");
  assert.equal(shown(68.4, null), 68);
});

test("every grain line in The Read and its card pill print the same percentile (real data)", () => {
  const a = JSON.parse(read("data/cot-analysis.json"));
  assert.ok(a.grain_lines.length >= 2);
  for (const g of a.grain_lines) {
    const m = /the (\d+)(?:st|nd|rd|th) percentile/.exec(g.text);
    if (!m) continue;
    const pill = pillText(a, g.key);
    const c = a.commodities[g.key];
    if (c.crowded) continue;   // a crowded pill names the side, not the number
    assert.match(pill, new RegExp("^" + m[1] + "(st|nd|rd|th) percentile"), `${g.key}: Read says ${m[0]}, pill says ${pill}`);
  }
});

test("soybeans at 89.8 not crowded: the pill says 89th, with or without crowd.shown", () => {
  const a = JSON.parse(read("data/cot-analysis.json"));
  const b = JSON.parse(JSON.stringify(a));
  const c = b.commodities.beans;
  c.crowded = null;
  c.crowd = Object.assign({}, c.crowd, { pctl: 89.8, crowded: null });
  delete c.crowd.shown;
  assert.match(pillText(b, "beans"), /^89th percentile/);
  c.crowd.shown = 89;
  assert.match(pillText(b, "beans"), /^89th percentile/);
});
