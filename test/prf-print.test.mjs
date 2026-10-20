/* The /prf print sheet (Sig, Oct 18: "very good", one Letter page).
 *
 * WHY. A rancher prints this and takes it to the kitchen table or the agent's
 * office. It has to carry, on one page and readable at arm's length: the
 * AGSIST header with the grid, county and state; the policy as chosen
 * (use, acres, coverage, productivity factor, months); the answer (premium,
 * USDA's share, your share); every year's payout; the chart; the conditions
 * and sources with their dates; a QR code back to the live page with the same
 * settings; one plain "what this means" line; a sold state's sponsor box
 * (test/prf-sponsor.test.mjs) and nothing when unsold. The byline stays at the
 * foot, never in the header. "What the numbers would pick" never prints.
 * The one-page fit is checked by rendering a PDF (Playwright), not here.
 *
 *   node --test test/prf-print.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const H = read("prf.html"), CSS = read("components/prf.css"), JS = read("components/prf.js");
const PRINT = CSS.slice(CSS.indexOf("@page { size: letter"), CSS.indexOf("/* ---- the state pages"));

test("the sheet's parts are in the page, from the generator", () => {
  const head = H.slice(H.indexOf('<div class="prf-ph"'), H.indexOf('<dl class="prf-pp"'));
  assert.match(head, /<img class="prf-ph-logo" src="\/img\/logo-agsist-onlight\.svg" alt="AGSIST"/, "branded header");
  assert.ok(head.includes('id="prf-ph-g"') && head.includes('id="prf-ph-d"') && head.includes('id="prf-pq"'), "grid line, date line, QR");
  assert.doesNotMatch(head, /Lindquist|By </, "no name at the top");
  for (const id of ["prf-pp", "prf-pm", "prf-chart-pm", "prf-psrc", "prf-yrs-p"]) assert.ok(H.includes(`id="${id}"`), id);
  assert.match(H, /<div class="prf-spon-p" id="prf-spon-p" hidden><\/div>/, "the sponsor's print box ships empty and hidden");
  assert.ok(H.indexOf("/components/qr.js?v=") > 0 && H.indexOf("/components/qr.js?v=") < H.indexOf("/components/prf.js?v="), "qr.js loads before prf.js");
  assert.ok(H.indexOf('class="prf-byline"') > H.indexOf('id="prf-spon-p"'), "the byline comes last");
  assert.ok(read("scripts/make_prf_html.py").includes('id="prf-pq"'), "from the generator, not a hand edit");
  const foot = H.slice(H.indexOf('<p class="prf-printfoot">'), H.indexOf('<div class="prf-spon-p"'));
  assert.match(foot, /<span class="prf-made"><b>Made by AGSIST<\/b> \(agsist\.com\): Sigurd Lindquist, CCA, who owns a licensed crop insurance agency\. This sheet sells nothing and refers no one; a sponsor has no say over any figure\. <!--prf:check-->[^<]+<!--\/prf:check--><\/span>/,
    "the Made by line at the foot of the sheet, with the stamped check line");
  assert.match(foot, /AD-1026/); assert.match(foot, /sales closing <!--prf:sales_long-->/);
});

test("print CSS: one Letter page, the sheet shown, the panels and the pick hidden, type no smaller than 9pt", () => {
  assert.match(CSS, /@page \{ size: letter;/);
  assert.ok(PRINT.includes(".prf[data-prf] .prf-byline"), "on the sheet the Made by line stands in for the byline");
  for (const sel of ["#prf-optimize", ".next-links", ".prf-o6", ".prf-o3", ".prf-acts", ".prf-prose"]) assert.ok(PRINT.includes(sel), "hidden in print: " + sel);
  for (const sel of [".prf-ph {", ".prf-pp {", ".prf-pm {", ".prf-pq {", ".prf-pbot {", ".prf-spon-p:not([hidden])"]) assert.ok(PRINT.includes(sel), "styled in print: " + sel);
  const sizes = [...PRINT.matchAll(/font-size:\s*([\d.]+)pt/g)].map((m) => +m[1]);
  assert.ok(sizes.length > 10 && Math.min(...sizes) >= 9, "no print type under 9pt: " + Math.min(...sizes));
  assert.match(CSS, /\.prf-ph, \.prf-pp, \.prf-pcap, \.prf-pbot, \.prf-pq, \.prf-spon-p \{ display: none; \}/, "hidden on screen");
  /* the plain "What this means" line shows on screen too (Sig, Oct 20), and hides only when empty */
  assert.match(CSS, /\.prf-pm:empty \{ display: none; \}/);
  assert.ok(!/\.prf-pcap[^{]*\.prf-pm|\.prf-pm[^{]*\.prf-pcap/.test(CSS.split("@media print")[0]), "the plain line is not in the screen-hidden list");
});

test("prf.js fills the sheet on every render: the live link with the same settings, the QR, the sources with dates, one plain line", () => {
  assert.match(JS, /drawPrintYears\(R\); drawPrintSheet\(R\);/);
  const fn = JS.slice(JS.indexOf("function drawPrintSheet"), JS.indexOf("function download"));
  assert.match(fn, /liveUrl\(\)/); assert.match(JS, /function liveUrl\(\) \{ return 'https:\/\/agsist\.com' \+ shareUrl\(\)/);
  assert.match(fn, /window\.AgQR\.svg\(url/);
  for (const k of ["Use of the land", "Acres", "Coverage level", "Productivity factor", "Months insured"]) assert.ok(fn.includes(k), k);
  assert.match(fn, /adm_last_modified/); assert.match(fn, /isoDay\(meta\.built\)/);
  const means = JS.slice(JS.indexOf("function meansLine"), JS.indexOf("function drawPrintSheet"));
  assert.match(means, /only because USDA pays the rest/);
  assert.match(means, /under your ' \+ usd\(you\) \+ ' share too/);
  assert.match(means, /covered the whole/);
  assert.doesNotMatch(fn + means, /—|&mdash;/, "no em dashes");
  assert.doesNotMatch(fn + means, /agent|best|recommend/i, "neutral");
});
