/* ARC-IC on /arc-plc (Oct 16, 2026 head-to-head, change 1).
 *
 * Texas A&M AFPC (2026 ARC-IC Decision Aid, Oct 2026) and farmdoc (Farm Bill
 * What-If Tool, Oct 16, 2026) now run ARC-IC. Running it honestly needs the
 * farm's own yields, every ARC-IC farm in the state, and FSA's ARC-IC rules
 * under the 2025 law, which are not on the references branch yet. So the page
 * explains what it takes and links the two tools, and prints no ARC-IC figure.
 * Quotes are from the saved copies: fsa-arc-plc ("which both provide
 * crop-by-crop protection, or ARC-Individual (ARC-IC), which protects the
 * entire farm") and bench-arc-plc-1 (AFPC: "combines every FSA farm you have
 * enrolled in ARC-IC in one state into a single ARC-IC farm").
 *
 *   node --test test/arc-plc-ic.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = readFileSync(ROOT + "arc-plc.html", "utf8");
const sec = PAGE.match(/<h2 id="arc-ic">[\s\S]*?(?=<h2 )/)[0];
const plain = (h) => h.replace(/<[^>]+>/g, " ").replace(/&rsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the ARC-IC section explains, links both tools and quotes its sources", () => {
  const t = plain(sec);
  assert.match(t, /What about ARC-IC\?/);
  assert.match(t, /"provide crop-by-crop protection," while ARC-IC "protects the entire farm\."/);
  assert.match(t, /"combines every FSA farm you have enrolled in ARC-IC in one state into a single ARC-IC farm\."/);
  assert.match(t, /This page does not run ARC-IC, and it does not guess\./);
  assert.ok(sec.includes('href="https://afpc.tamu.edu/tools"'));
  assert.ok(sec.includes('href="https://farmdoc.illinois.edu/fast-tools/arc-co-plc-model"'));
  assert.match(PAGE, /<a href="#arc-ic">What it takes to check it<\/a>/);
  assert.doesNotMatch(PAGE, /This tool does not model it/, "the old one-liner is replaced");
});

test("no ARC-IC number is printed: no percent, dollar or guarantee figure", () => {
  const t = plain(sec);
  assert.doesNotMatch(t, /%|\$/);
  const nums = (t.match(/\d[\d,.]*/g) || []).filter((n) => !/^20(25|26)$/.test(n));
  assert.deepEqual(nums, [], "only the years 2025 and 2026 appear");
  assert.doesNotMatch(sec, /—|&mdash;/);
});

test("the FAQ and its JSON-LD answer 'Does this calculator cover ARC-IC?'", () => {
  assert.match(PAGE, /<summary>Does this calculator cover ARC-IC\?<\/summary>/);
  const ld = [...PAGE.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const qa = ld.flatMap((x) => (Array.isArray(x) ? x : [x])).flatMap((x) => x.mainEntity || [])
    .find((q) => q.name === "Does this calculator cover ARC-IC?");
  assert.ok(qa, "in FAQPage");
  assert.match(qa.acceptedAnswer.text, /^No\. ARC-IC covers the whole farm on your own yields/);
  assert.doesNotMatch(qa.acceptedAnswer.text, /%|\$|—/);
});
