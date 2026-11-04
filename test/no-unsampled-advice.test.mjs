/* No buy or sell advice without a sample (site panel, Nov 4 2026).
 *
 * The corn, soybean and wheat futures pages carried a "What I'd do" box
 * (components/futures.js buildActionLine) that told a grower to scale in
 * forward sales, hold what they can store or buy puts, from a 52-week range
 * and a breakeven alone. Nothing behind it was ever tested: no sample, no hit
 * rate. It was removed. This keeps it, and anything like it, out.
 *
 * A page (root *.html) or browser script (components/*.js) fails when it
 * prints advice wording (the list below) unless a sample line sits within
 * SAMPLE_WINDOW characters of it: "tested on 209 weeks", "sample of 31
 * seasons", "out of sample". A tool name such as "Sell now or store?" is a
 * question, not advice, and is not on the list. daily/ and changelog.html are
 * history and are not scanned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SAMPLE_WINDOW = 400;

const APOS = String.raw`(?:'|&rsquo;|&#x27;|&#39;|’|\\')`;
export const ADVICE = [
  new RegExp(String.raw`What I${APOS}d do`, "i"),
  new RegExp(String.raw`\bwe${APOS}?d (?:sell|buy|hold|store)\b`, "i"),
  /\byou should (?:sell|buy|hold|store|price|hedge)\b/i,
  /\bscal(?:e|ing)[- ]in (?:forward )?sales\b/i,
  /\bselling (?:here|hard) (?:locks in|at the bottom)/i,
  /\bhold what you can store\b/i,
  /\bwaiting has often paid\b/i,
  /\b(?:good|right|a) time to (?:sell|buy|price|hedge)\b/i,
  /\bbuy (?:puts|calls) now\b/i,
  /\bno forward-selling opportunity\b/i,
  /\bpatience setup\b/i,
];
export const SAMPLE = /\b(?:tested on|sample of|out[- ]of[- ]sample|back-?tested on|hit rate)\b[^.]{0,80}?\d|\b\d[\d,]* (?:seasons|years|weeks|trades|cases)\b[^.]{0,60}?\b(?:tested|sample|back-?test)/i;

export function unsampled(text) {
  const out = [];
  for (const re of ADVICE) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    while ((m = g.exec(text))) {
      const lo = Math.max(0, m.index - SAMPLE_WINDOW), hi = m.index + m[0].length + SAMPLE_WINDOW;
      if (!SAMPLE.test(text.slice(lo, hi))) out.push(m[0]);
    }
  }
  return out;
}

function files() {
  const root = readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "changelog.html");
  const comps = readdirSync(ROOT + "components").filter((f) => f.endsWith(".js")).map((f) => "components/" + f);
  return [...root, ...comps];
}

test("the rule catches the removed box's wording and passes a sampled line", () => {
  const box = `<div class="mr-sec-lbl"> What I'd do</div><p>Below breakeven and in the lower quartile. Patience setup: selling here locks in losses. Hold what you can store.</p>`;
  assert.ok(unsampled(box).length >= 3, "the Nov 3 futures box wording is advice with no sample");
  assert.deepEqual(unsampled("Sell now or store? figures the carry from your elevator's bids."), [],
    "a tool name is not advice");
  const sampled = "In the lower quartile, waiting has often paid: tested on 31 seasons of Dec corn, 21 of 31 higher by March.";
  assert.deepEqual(unsampled(sampled), [], "advice with its sample line beside it passes");
});

test("no page or browser script prints buy or sell advice without a sample line", () => {
  const bad = [];
  for (const f of files()) {
    const hits = unsampled(readFileSync(ROOT + f, "utf8"));
    if (hits.length) bad.push(`${f}: ${[...new Set(hits)].join(" | ")}`);
  }
  assert.deepEqual(bad, [], "advice with no sample line nearby:\n" + bad.join("\n"));
});
