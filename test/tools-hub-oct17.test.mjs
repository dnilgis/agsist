/* /tools, Oct 17 scorecard: the chip row on a phone scrolls sideways, so it
 * fades at the right edge as a cue; the Tariffs card and the Harvest Price
 * Tracker line say what those pages now do; every menu link is on the hub. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const html = readFileSync(join(ROOT, "tools.html"), "utf8");

test("phone chip row carries a scroll cue and leaves room for the last chip", () => {
  const phone = html.match(/@media \(max-width: 600px\) \{([\s\S]*?)\n    \}/)[1];
  const rule = phone.match(/\.tf-chips \{[^}]*\}/)[0];
  assert.match(rule, /overflow-x: auto/);
  assert.match(rule, /mask-image: linear-gradient\(90deg,#000 calc\(100% - 40px\),transparent\)/);
  assert.match(rule, /padding: 2px 48px 6px 16px/, "end padding wider than the fade");
});

test("cards describe what the pages do now", () => {
  const card = html.match(/<a href="\/tariffs" class="tool-card"[^>]*>([\s\S]*?)<\/a>/)[1];
  assert.match(card, /weekly count of China&rsquo;s soybean buying/);
  assert.match(html, /href="\/harvest-price-tracker"[^>]*>[\s\S]{0,200}short-crop check/);
});

test("every link in the site menu is reachable from the hub", () => {
  const menu = readFileSync(join(ROOT, "components/header.html"), "utf8");
  const hub = new Set([...html.matchAll(/href="(\/[a-z0-9\/-]*)"/g)].map((m) => m[1]));
  const miss = [...new Set([...menu.matchAll(/href="(\/[a-z0-9\/-]*)"/g)].map((m) => m[1]))].filter((h) => !hub.has(h));
  assert.deepEqual(miss, []);
});
