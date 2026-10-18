// /cot, Oct 16 head to head: the corn panel opened "Funds hold an unusually
// large net long" at the 81st percentile while The Read and the card called
// the same number "high side, not crowded". One phrase now, from crowdWord()
// and the pipeline's crowded flag.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MKT = readFileSync(new URL("../components/cot-market.js", import.meta.url), "utf8");
const ANA = readFileSync(new URL("../components/cot-analysis.js", import.meta.url), "utf8");
const CX = JSON.parse(readFileSync(new URL("../data/cot-analysis.json", import.meta.url), "utf8"));

function lift(src, name) {
  const start = src.indexOf("function " + name + "(");
  let depth = 0;
  for (let p = src.indexOf("{", start); p < src.length; p++) {
    if (src[p] === "{") depth++;
    else if (src[p] === "}" && --depth === 0) return src.slice(start, p + 1);
  }
}
const verdict = new Function("c", `
  var esc = function(s){ return String(s).replace(/[&<>"]/g, function(x){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]; }); };
  var num = function(n){ return Number(n).toLocaleString('en-US'); };
  var sgn = function(n){ return (n > 0 ? '+' : '') + n; };
  ${lift(ANA, "ord")} ${lift(ANA, "crowdWord")} ${lift(MKT, "verdictLine")}
  return verdictLine(c);`);

test("no 'unusually large' in the panel; the words are the percentile's", () => {
  assert.ok(!/unusually large/.test(MKT));
  const corn = CX.commodities.corn;
  const out = verdict({ ...corn, studies: {} });
  const p = corn.pctl.net_oi_all;
  if (p >= 75 || p <= 25) {
    const word = p >= 90 ? "top" : p >= 75 ? "high side" : p <= 10 ? "bottom" : "low side";
    assert.match(out, new RegExp("at the " + Math.round(p) + "(st|nd|rd|th) percentile"));
    assert.ok(out.includes(word), out);
    assert.ok(out.includes(corn.crowded ? "crowded " + corn.crowded : "not crowded"), out);
  }
});

test("hand case: net long at 81.4 reads 'high side, not crowded'; crowded long at 93 reads 'top 7%, crowded long'", () => {
  const base = { net: 329839, label: "Corn", first_week: "2010-01-05", capacity: { to_flat: 1, room_down: 2, room_up: 3 }, studies: {} };
  assert.match(verdict({ ...base, pctl: { net_oi_all: 81.4 }, crowded: null }), /at the 81st percentile of their own record since 2010 \(high side, not crowded\)/);
  assert.match(verdict({ ...base, pctl: { net_oi_all: 93 }, crowded: "long" }), /\(top 7%, crowded long\)/);
});

test("the panel script and its loader were re-versioned", () => {
  assert.match(ANA, /cot-market\.js\?v=3/);
  assert.match(readFileSync(new URL("../cot.html", import.meta.url), "utf8"), /cot-analysis\.js\?v=3/);
});
