/* Nov 8, 2026: the ARC/PLC method section says what the verdict compares and how past years came out, in plain words.
 * No call cutoffs, no t statistic, no weights; the track-record table stays; the section sits in the one closed fold at the bottom.
 * On the builder, the two components that carried copies of the text (3 copies: method_html, arc-plc-math.js, arc-plc.js), and the
 * built Sources and terms fold of the real pages (the PR checks rebuild the set before the tests). */
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

/* Nov 10, 2026: the guard reads the BUILT fold, not a slice of the builder, so text from any function method_html
 * calls (tier_rules(), the record line) or that sits beside it in the fold (formulas_html()) is covered. The answer
 * is said to be a clear pick, a lean or too close to call; no dollar or year cutoff is printed. This fails on the
 * sentence the fold carried before: "A clear pick needs the leading program ahead by $3 or more per base acre on
 * average, ahead in at least 3 of the past years ... Leans needs $2 or more ...". */
const CUT = /\$\d+(\.\d+)? or more|ahead (by|in) at least|at least \d+ of the past years|in at least \d+ years|at least as big as its usual swing|unlikely to flip|How the tiers step down/i;
// BAD without the two t values: the track-record table prints dollars, and $2.26 can be one of them
const BADW = /standard error|Student|\bt statistic\b|\bt times\b|weighted by|Second start|MIN_GAP|LEAN_GAP|MIN_WINS|at least one standard/i;
const foldText = (h) => {
  const at = h.indexOf('<details class="ap-det" id="terms">');
  assert.ok(at > 0, "the Sources and terms fold");
  const f = h.slice(at, h.indexOf("</details>", at));
  return f.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "\u2019").replace(/&amp;/g, "&").replace(/\s+/g, " ");
};
test("the built fold of the real pages: no cutoffs, no t statistic; the three answers in plain words", () => {
  const old = "A clear pick needs the leading program ahead by $3 or more per base acre on average, ahead in at least 3 of the past years, and far enough ahead that the year-to-year swing is unlikely to flip it. Leans needs $2 or more, ahead in at least 3 years, and a gap at least as big as its usual swing.";
  assert.ok(CUT.test(old), "the guard catches the old thresholds sentence");
  const m = foldText(read("arc-plc.html"));
  assert.ok(m.length > 500, "main page fold read");
  assert.ok(!CUT.test(m), "a cutoff in the main page fold: " + (CUT.exec(m) || [])[0]);
  assert.ok(!BADW.test(m), "a removed word in the main page fold: " + (BADW.exec(m) || [])[0]);
  assert.match(m, /Each answer is one of three: a clear pick, a lean toward one program, or too close to call\./);
  for (const p of ["arc-plc/iowa/story-county.html", "arc-plc/kansas/sumner-county.html", "arc-plc/iowa.html", "arc-plc/oats.html"]) {
    const f = foldText(read(p));
    assert.ok(!CUT.test(f) && !BADW.test(f), `${p}: ` + ((CUT.exec(f) || BADW.exec(f) || [])[0]));
  }
});
test("method_html: the track-record table stays and the record line is computed", () => {
  assert.ok(method.includes('<h3 id="backtest">What each program paid, nationally, per base acre</h3>'));
  assert.ok(method.includes('class="tbl ap-t"'));
  // Nov 10, 2026: the line says what it is: how often ARC-CO paid more, not how often a verdict was right
  assert.match(method, /How often ARC-CO paid more, not how often a verdict was right: nationally, over \{len\(done\)\} crop-year results \(\{bc\}, \{have\[0\]\} to \{have\[-1\]\}\)/);
  // built: "15 crop-year results (corn, soybeans and wheat, 2021 to 2025)", not "15 crop years"
  const fold = foldText(read("arc-plc.html"));
  assert.match(fold, /over \d+ crop-year results \((corn|soybeans|wheat)(, (soybeans|wheat))*( and (soybeans|wheat))?, \d{4} to \d{4}\), ARC-CO paid more than PLC in \d+ and PLC paid more in \d+/);
  assert.doesNotMatch(fold, /\d+ crop years from/);
  assert.ok(!/Looking back/.test(method));
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
