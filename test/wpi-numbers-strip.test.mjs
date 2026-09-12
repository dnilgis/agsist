// TWO RENDERERS, ONE STRIP, COMPARED BYTE FOR BYTE.
//
// "Every number on this report" is drawn twice: numbersEl() in
// whats-priced-in.html for the live page, and numbers_el() in
// scripts/prerender_wpi_scorecard.py for the baked copy a crawler and a
// pre-hydration reader see. This repo has been burned by that shape before --
// days_until() was corrected in the JS and not in the port, and for one morning
// the baked card said "tomorrow" over a card the page rendered as "today", off
// one JSON file.
//
// So this does not check either renderer's taste. It runs BOTH on the same rows
// and fails on any byte of difference. The JS is pulled out of the shipped page
// rather than copied here, because a copy is a third implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The page's numbersEl(), lifted from the file that ships it. Braces are
// counted rather than regex-matched so a nested function body cannot end the
// slice early.
function liftFromPage(name) {
  const src = readFileSync(join(ROOT, "whats-priced-in.html"), "utf8");
  const start = src.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + "() is no longer in whats-priced-in.html");
  let i = src.indexOf("{", start), depth = 0, end = -1;
  for (let p = i; p < src.length; p++) {
    if (src[p] === "{") depth++;
    else if (src[p] === "}" && --depth === 0) { end = p + 1; break; }
  }
  assert.notEqual(end, -1, name + "() has unbalanced braces");
  return src.slice(start, end);
}

const jsStrip = new Function(
  "rows",
  liftFromPage("esc") + "\n" + liftFromPage("numbersEl") + "\nreturn numbersEl(rows);"
);

function pyStrip(rows) {
  return execFileSync("python3", ["-c", `
import json, sys
sys.path.insert(0, "scripts")
import prerender_wpi_scorecard as m
sys.stdout.write(m.numbers_el(json.load(sys.stdin)))
`], { cwd: ROOT, input: JSON.stringify(rows), encoding: "utf8" });
}

// The real September rows, plus the awkward ones: an unprinted figure, a
// printed figure nobody surveyed, an integer-valued float, no range, and a
// label and a source carrying characters that have to be escaped identically.
const ROWS = [
  { key: "corn_yield_2627", label: "2026/27 corn yield", unit: "bu/acre",
    expected: 178.1, low: 173.2, high: 182.9, usda_current: 180.7,
    actual: 178.5, surprise: "in line", gap_pct: 0.2, why: "",
    source: "https://example.test/a?x=1&y=2" },
  { key: "soy_yield_2627", label: "2026/27 soybean yield", unit: "bu/acre",
    expected: 52.5, low: 51.5, high: 53.3, usda_current: 52.7,
    actual: 52.8, surprise: "bearish", gap_pct: 0.6, why: "", source: null },
  { key: "d", label: "2026/27 corn ending stocks", unit: "mil bu",
    expected: 2100, low: null, high: null, usda_current: null,
    actual: null, surprise: "", gap_pct: null, why: "not printed yet", source: null },
  { key: "e", label: 'Sorghum "production" & feed <use>', unit: "mil bu",
    expected: null, low: null, high: null, usda_current: 370,
    actual: 370, surprise: "", gap_pct: null,
    why: "no trade estimate was published for this one", source: null },
];

test("the baked strip and the live strip are the same bytes", () => {
  assert.equal(pyStrip(ROWS), jsStrip(ROWS));
});

test("every row shape is exercised, not just the easy one", () => {
  const html = jsStrip(ROWS);
  assert.match(html, /in line<\/span>/);
  assert.match(html, /bearish<\/span>/);
  assert.match(html, /not printed yet/);
  assert.match(html, /no call<\/span>/);
  assert.match(html, /range 173\.2 to 182\.9/);
  assert.match(html, /Graded against the pre-report survey\./);
  assert.match(html, /Sorghum &quot;production&quot; &amp; feed &lt;use&gt;/);
  assert.match(html, /x=1&amp;y=2/);
});

test("before the print, both say so and neither grades anything", () => {
  const waiting = ROWS.map(r => ({ ...r, actual: null, surprise: "", why: "not printed yet" }));
  const js = jsStrip(waiting);
  assert.equal(pyStrip(waiting), js);
  assert.match(js, /USDA prints at 12:00 PM ET\. This fills in on its own\./);
  assert.doesNotMatch(js, /class="v (bull|bear|flat)"/);
});

test("no rows is no strip, in both, rather than an empty box", () => {
  assert.equal(jsStrip([]), "");
  assert.equal(pyStrip([]), "");
  assert.equal(jsStrip(null), "");
  assert.equal(pyStrip(null), "");
});

// EVERY HELPER THIS BLOCK CALLS IS DECLARED IN THIS BLOCK.
//
// The page has two script tags and each is its own IIFE. numbersEl() was
// written to call esc(), and an identical esc() does exist -- 150 lines down,
// sealed inside the scorecard's IIFE. The result was a ReferenceError thrown
// inside resultBanner, swallowed by the fetch's .catch, and a flagship panel
// reading "Report expectations are briefly unavailable" with no error anywhere
// a person would look. Rendering the page found it; nothing else would have.
//
// So: gather every name declared anywhere in the renderers' own block, gather
// every name it calls, and require the second set to sit inside the first plus
// the language's own. A helper borrowed across the IIFE wall fails here.
const GLOBALS = new Set([
  "String", "Number", "Boolean", "Math", "Date", "JSON", "Object", "Array",
  "RegExp", "Error", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "fetch", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "requestAnimationFrame", "if", "for", "while", "switch",
  "catch", "return", "typeof", "function", "else", "do",
  // Declared at page scope, outside every IIFE, and verified in a browser to be
  // a real window global: whats-priced-in.html line ~390.
  "gaEvent",
]);

test("the renderers call nothing that lives in the other script block", () => {
  const src = readFileSync(join(ROOT, "whats-priced-in.html"), "utf8");
  const at = src.indexOf("function numbersEl(");
  assert.notEqual(at, -1);
  const raw = src.slice(src.lastIndexOf("<script>", at), src.indexOf("</script>", at));
  // Comments and string literals are not code. Without this, a CSS
  // `color:var(--wp-mut)` inside a template reads as a call to var(), and a
  // comment naming days_until() reads as a call to it.
  const block = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  const declared = new Set();
  for (const re of [/function\s+([A-Za-z_$][\w$]*)\s*\(/g,
                    /\bvar\s+([A-Za-z_$][\w$]*)/g,
                    /\b(?:let|const)\s+([A-Za-z_$][\w$]*)/g]) {
    for (const m of block.matchAll(re)) declared.add(m[1]);
  }
  // named function parameters count as declared too
  for (const m of block.matchAll(/function\s*[A-Za-z_$\w$]*\s*\(([^)]*)\)/g)) {
    for (const a of m[1].split(",")) { const n = a.trim(); if (n) declared.add(n); }
  }

  const missing = new Set();
  for (const m of block.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[2];
    if (!declared.has(name) && !GLOBALS.has(name)) missing.add(name);
  }
  assert.deepEqual([...missing], [],
    "called but declared in neither this script block nor the language: " + [...missing].join(", "));
});
