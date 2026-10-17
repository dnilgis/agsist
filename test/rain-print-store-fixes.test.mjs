/* /rain-print store fixes from the 2026-10-16 head to head
 * (bench/results/2026-10-16-rain-print.md):
 *   - R1: no NOAA error on load while the example print is up; the reader's own
 *     failed Draw gets a plain note with Try again (browser test F2 in
 *     rain-print-solid.test.mjs; the code shape here);
 *   - the framed mockup is open near the prices, under Pay, and says it is a mockup;
 *   - the frame is described with known facts only, no made-up sizes;
 *   - R2: the year-in-numbers FAQ works before a draw;
 *   - the Christmas cutoffs agree with the hand-worked business-day count.
 *
 *   node --test test/rain-print-store-fixes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "rain-print.html", "utf8");
const S = readFileSync(ROOT + "components/rain-print.js", "utf8");
const J = JSON.parse(readFileSync(ROOT + "data/rain-print.json", "utf8"));
const ctx = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
ctx.window = ctx;
vm.runInNewContext(S, ctx);
const RP = ctx.RainPrint;

test("R1: a failed sample says nothing; only the reader's own failed draw shows Try again, not in red", () => {
  assert.ok(!/isn\\u2019t answering right now, so the sample/.test(S), "the old on-load NOAA line is gone");
  assert.ok(!/RETRY_SAMPLE/.test(S), "no Try again for a sample nobody asked for");
  const sampleCatch = S.slice(S.indexOf("if (SAMPLE) {\n        /* The sample failed."), S.indexOf("if (err === 'blocked' || err === 'noart') return;"));
  assert.ok(sampleCatch.length > 0 && sampleCatch.length < 800, "the sample's catch is found");
  assert.match(sampleCatch, /clearSample\(\);\s*return;/);
  assert.ok(!/statusEl|setStatus|rp-retry-row|rp-bad/.test(sampleCatch), "the sample's failure writes no status and shows no button");
  // failDraw and keepDrawn: a retryable error (NOAA or the town lookup slow) is a plain note
  assert.equal((S.match(/!\(err && err\.retry\)\);\n    \$\('rp-retry-row'\)\.hidden = !\(err && err\.retry\);/g) || []).length, 2);
  // clearSample keeps the example print: it puts back the art the page loaded with
  assert.match(S, /var EMPTY_ART = art\.innerHTML/);
  assert.match(HTML, /<div class="rp-art rp-empty" id="rp-art"><picture class="rp-ex">/);
});

test("the framed mockup is open under Pay, tagged Mockup, not inside What you get", () => {
  const fig = HTML.match(/<figure class="rp-onwall"[\s\S]*?<\/figure>/g) || [];
  assert.equal(fig.length, 1, "one mockup picture");
  assert.match(fig[0], /<span class="rp-ex-tag" aria-hidden="true">Mockup<\/span>/);
  assert.match(fig[0], /alt="Mockup: a framed Rain Print in a black frame/, "the mockup is an older render: its alt names no size");
  assert.match(fig[0], /<figcaption>Mockup of a framed print\. Photos of real prints coming soon\.<\/figcaption>/);
  // 2026-10-17 (gift-buyers panel): lazy left it blank on a phone under Pay; eager, and low priority so it doesn't hold up the page
  assert.match(fig[0], /loading="eager" fetchpriority="low" decoding="async"/, "it loads, and doesn't hold up the page");
  const at = HTML.indexOf('<figure class="rp-onwall"');
  const box = HTML.match(/<details class="rp-box-d">[\s\S]*?<\/details>/)[0];
  assert.ok(!/rp-onwall/.test(box), "not hidden in the collapsed box");
  const payWrapEnd = HTML.indexOf('<p class="rp-note" id="rp-buy-note" aria-live="polite"></p>\n          </div>');
  assert.ok(payWrapEnd > 0 && at > payWrapEnd, "after the Pay block, so a phone's Pay button does not move down");
  assert.ok(at < HTML.indexOf('id="rp-gift-line"'), "and right by the prices, before the gift and shipping lines");
  assert.match(HTML, /\.rp-onwall-i\{position:relative\}/, "the tag sits on the picture");
});

test("the frame: only what Sig has said, no made-up sizes", () => {
  const box = HTML.match(/<h3>Framed<\/h3><ul>[\s\S]*?<\/ul>/)[0];
  // Sig, 2026-10-17: a 13 x 19 black frame with a white mat; the real glass front confirmed the same day
  for (const want of [/<li>A 13 x 19 black frame with a white mat, ready to hang<\/li>/, /<li>Real glass front, packed with corner guards and foam, double-boxed<\/li>/]) assert.match(box, want);
  assert.doesNotMatch(box, /no mat|a little bigger/);
  const big = HTML.match(/<details><summary>How big is it\?<\/summary><p>[\s\S]*?<\/details>/)[0];
  assert.match(big, /The framed one comes in a 13 x 19 black frame with a white mat and a real glass front, ready to hang\./);
  assert.doesNotMatch(big, /no mat|trim|a little bigger/);
  // the structured data says the same
  assert.match(HTML, /"text": "[^"]*The framed one comes in a 13 x 19 black frame with a white mat and a real glass front, ready to hang\./);
  // no moulding width, outside size, weight or hanger until Sig measures them
  const vis = HTML.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(!/moulding|molding|sawtooth|wire hanger|\b\d+(\.\d+)?\s?(x|by)\s?\d+(\.\d+)?\s?(in|inches)? (outside|overall)|\d+(\.\d+)?[- ]?(inch|in\.?) (wide|deep)|\b\d+(\.\d+)? ?(lb|lbs|pounds)\b/i.test(vis), "no frame size or weight invented");
  assert.ok(!/stock frame/.test(HTML), "a black frame, not a 'stock' one (2026-10-15)");
  assert.ok(!/acrylic|archival/i.test(vis.replace(/never claim[^.]*archival/gi, "")), "glass, and never 'archival'");
  assert.ok(!/—|&mdash;/.test(vis), "no em dashes");
});

test("R2: the year-in-numbers FAQ makes sense before anything is drawn", () => {
  assert.ok(!/Under More options, The year in numbers shows/.test(HTML), "the old wording is gone, page and structured data");
  assert.match(HTML, /<details><summary>Can I see the year&rsquo;s total for free\?<\/summary><p>Yes\. Drawing it is free and so are the numbers\. Once your year is drawn, open More options, then The year in numbers\. It shows the year&rsquo;s rain/);
  assert.match(HTML, /"text": "Yes\. Drawing it is free and so are the numbers\. Once your year is drawn, open More options, then The year in numbers\. It shows the year’s rain/);
  // the panel it names is where it says: under More options, shown once a year is drawn
  assert.match(HTML, /<details class="rp-stats-d"><summary>The year in numbers<\/summary>/);
});

test("Christmas cutoffs: the data file agrees with a hand count, and the slack is zero (reported, dates unchanged)", () => {
  // framed: order Wed Dec 9, 1 day proof + 1 day OK + 3 to ship + 6 in the mail = 11 business days:
  // Dec 10, 11, 14, 15, 16, 17, 18, 21, 22, 23, 24. Print: Dec 10 + 10 = Dec 24. Thanksgiving is before both.
  assert.equal(J.framed_christmas_cutoff, "2026-12-09");
  assert.equal(J.print_christmas_cutoff, "2026-12-10");
  assert.equal(RP.christmasCutoff(J, "framed12x18", 2026), J.framed_christmas_cutoff);
  assert.equal(RP.christmasCutoff(J, "print12x18", 2026), J.print_christmas_cutoff);
  assert.equal(RP.addBizDays("2026-12-09", 11, J.holidays), "2026-12-24");
  assert.equal(RP.addBizDays("2026-12-10", 10, J.holidays), "2026-12-24");
  // two business days of slack would mean Mon Dec 7 (framed) and Tue Dec 8 (print)
  assert.equal(RP.addBizDays("2026-12-07", 13, J.holidays), "2026-12-24");
  assert.equal(RP.addBizDays("2026-12-08", 12, J.holidays), "2026-12-24");
  // no slack field exists, so the page shows the cutoffs as Sig set them, nothing else
  assert.ok(!Object.keys(J).some((k) => /slack|order_by/i.test(k)));
});
