/* /pod-counts, the 2026-10-15 head-to-head fix: a visible byline beside the
 * working-paper date, and the same person as the Article's author in the
 * JSON-LD (it named only the site).
 *
 *   node --test test/pod-counts-h2h.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HTML = readFileSync(new URL("../pod-counts.html", import.meta.url), "utf8");

test("the byline is visible next to the working-paper date", () => {
  const stamp = /<div class="pc-stamp">([\s\S]*?)<\/div>/.exec(HTML);
  assert.ok(stamp, "pc-stamp");
  assert.match(stamp[1], /Sigurd Lindquist/);
  assert.match(stamp[1], /Certified Crop Adviser \(CCA\)/);
  assert.match(stamp[1], /19 August 2026/);
});

test("the Article's author in the JSON-LD is the same person", () => {
  const blocks = [...HTML.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const nodes = blocks.flatMap((b) => b["@graph"] || [b]);
  const art = nodes.find((n) => n["@type"] === "Article");
  assert.ok(art, "Article node");
  assert.equal(art.author["@type"], "Person");
  assert.equal(art.author.name, "Sigurd Lindquist");
});
