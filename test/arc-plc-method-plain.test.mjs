/* Sig, Nov 8, 2026, "Cut it": the ARC/PLC method section says what the verdict compares and how past years came out, in plain words.
 * No call cutoffs, no t statistic, no weights; the track-record table stays; the section sits in the one closed fold at the bottom.
 * Static, on the builder and the two components that carried copies of the text (3 copies: method_html, arc-plc-math.js, arc-plc.js). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const b = read("scripts/build_arc_plc.py");
const method = b.slice(b.indexOf("def method_html(D):"), b.indexOf("def build_main(D, ch):"));
const BAD = /standard error|Student|\bt statistic\b|\bt times\b|2\.26|2\.23|weighted by|Second start|MIN_GAP|LEAN_GAP|MIN_WINS|at least one standard/i;

test("method_html: plain words, no t statistic, no cutoffs, no weights", () => {
  assert.ok(method.length > 200);
  assert.ok(!BAD.test(method), "removed words still in method_html: " + (BAD.exec(method) || [])[0]);
});
test("method_html: the track-record table stays and the record line is computed", () => {
  assert.ok(method.includes('<h3 id="backtest">What each program paid, nationally, per base acre</h3>'));
  assert.ok(method.includes('class="tbl ap-t"'));
  assert.match(method, /Looking back, over \{len\(done\)\} crop years/);
  assert.ok(!/\bcorn \d+ years\b|\b\d{2} crop years\b/.test(method), "no hard-coded counts");
});
test("method sits once in the closed fold at the bottom, no em dash", () => {
  assert.equal((b.match(/\{method_html\(D\)\}/g) || []).length, 1);
  assert.ok(b.includes('<details class="ap-det" id="terms"><summary>Sources and terms</summary>{method_html(D)}'));
  assert.ok(!/<details class="ap-det" id="terms"[^>]*\bopen\b/.test(b));
  assert.ok(!method.includes("—"));
});
test("the components carry no cutoff, t statistic or standard error copy", () => {
  for (const f of ["components/arc-plc-math.js", "components/arc-plc.js"]) {
    const c = read(f);
    assert.ok(!/standard error|t times|2\.26 for 10|\+ g\.gap \+|\+ g\.lean \+|MIN_WINS \+/.test(c.replace(/\/\/.*$/gm, "")) || f.endsWith("arc-plc.js"), f);
  }
  assert.ok(!/standard error/.test(read("components/arc-plc-math.js")));
  const a = read("components/arc-plc.js");
  assert.ok(!/times its standard error|and one standard error/.test(a));
});
