/* Night audit, Oct 19, 2026 (AI answer engines). llms.txt and the wheat page told engines things
 * that were not true: Sig was "a licensed crop insurance agent" (the standing byline is "Sigurd
 * Lindquist, Certified Crop Adviser (CCA)", never "crop insurance agent"), cash bids came from
 * "a licensed feed" (the Barchart feed is off), and /fertilizer showed "a USDA Illinois average"
 * (removed Oct 16). The live-key-gated copies in components/futures.js and scripts/fetch_bids.py
 * only print when the key is live and are pinned by fetch_bids' selftest: not checked here.
 *
 *   node --test test/llms-honest.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

test("llms.txt: standing byline, Farmers First as a plain fact, no crop insurance agent", () => {
  const t = read("llms.txt");
  assert.ok(!/crop insurance agent/i.test(t), "llms.txt calls Sig a crop insurance agent");
  assert.match(t.replace(/\n> ?/g, " "), /Sigurd Lindquist, Certified Crop Adviser \(CCA\)/);
  assert.match(t.replace(/\n> ?/g, " "), /also works at Farmers First Agri Service/);
});

test("no licensed-feed claim in llms.txt or any root page but the changelog", () => {
  assert.ok(!/licensed/i.test(read("llms.txt")), "llms.txt still names a licensed feed");
  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "changelog.html");
  const bad = pages.filter((f) => /licensed (cash-bid )?feed/i.test(read(f)));
  assert.deepEqual(bad, [], "pages naming a licensed feed: " + bad.join(", "));
});

test("llms.txt: no USDA Illinois fertilizer box", () => {
  assert.ok(!/USDA Illinois/.test(read("llms.txt")));
});
