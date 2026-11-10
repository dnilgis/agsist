// Nov 6 (curtain, Nov 5): pages and public data show the estimate, its range, its sources and its record, never
// the model's name or what it reads. The yield nowcast's id and the words that named its input are out of the files
// readers can load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = ["crop-tour.html", "conditions.html", "data/yield-nowcast.json", "data/analyst-scorecard.json",
  "data/analyst-estimates.json", "data/crop-tour.json", "llms.txt", "scripts/build_yield_nowcast.py",
  "scripts/build_croptour.py", "scripts/bake_seo.py", "scripts/build_share_images.py", "scripts/build_llms_txt.py"];
const BANNED = [/ge-linear/i, /ratings-only/i, /ratings model/i, /conditions-yield model/i, /direction ledger/i];

test("no model name or input word in the files readers load", () => {
  for (const f of FILES) {
    const t = readFileSync(join(ROOT, f), "utf8");
    for (const b of BANNED) assert.doesNotMatch(t, b, `${f}: ${b}`);
  }
  assert.ok(!("model" in JSON.parse(readFileSync(join(ROOT, "data/yield-nowcast.json"), "utf8"))), "yield-nowcast.json names no model");
});
