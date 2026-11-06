// Sig, Nov 6: the /about page has no "My other businesses" section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const h = readFileSync(new URL("../about.html", import.meta.url), "utf8");
test("about has no other-businesses section", () => {
  assert.doesNotMatch(h, /My other businesses/);
  assert.doesNotMatch(h, /Loke Drone/);
  assert.match(h, /<h2>Who pays for it<\/h2>/);
});
