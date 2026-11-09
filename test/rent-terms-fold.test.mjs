/* Curtain round 2 (Nov 9): every rent page (47 states and the hub) ends in one closed "Sources and terms" fold.
 * The NASS notice and the source and release lines are inside it; no formula, weight, threshold, file or job name
 * text is published on the page. node --test test/rent-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(ROOT + "rent").filter((f) => f.endsWith(".html"));
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const BANNED = /least.squares|14-?\s?y(ea)?r|\bfitted\b|trend fit|rebuilt? automatically|rebuilds? automatically|refreshed automatically|\.json|\.py\b|\.yml|workflow|state-rent-pages|build_state/i;

test("48 rent pages: one closed Sources and terms fold, last in the page, notices inside", () => {
  assert.equal(files.length, 48);
  for (const f of files) {
    const h = readFileSync(ROOT + "rent/" + f, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(folds.length, 1, f + ": exactly one fold");
    assert.ok(!/<details[^>]*\sopen/.test(folds[0]), f + ": closed");
    const i = main.indexOf(folds[0]);
    const fold = main.slice(i, main.indexOf("</details>", i));
    assert.ok(main.slice(main.indexOf("</details>", i) + 10).trim() === "", f + ": the fold is the last thing in the page body");
    assert.ok(fold.includes(NASS), f + ": NASS notice inside");
    assert.ok(fold.includes("Calculations by AGSIST") || fold.includes("calculations by AGSIST"), f + ": AGSIST calculation line inside");
    assert.match(fold, /Source: USDA NASS Cash Rents Survey/, f);
    assert.ok(!main.slice(0, i).includes(NASS), f + ": NASS notice appears once, in the fold");
    assert.ok(!/Source: USDA NASS Quick Stats/.test(main.slice(0, i)), f);
  }
});

test("no formula, weight, threshold, file or job name text on any rent page", () => {
  for (const f of files) {
    const h = readFileSync(ROOT + "rent/" + f, "utf8");
    const ld = (h.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join("\n");
    const text = h.slice(h.indexOf("<body")).replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "") + ld;
    const m = text.match(BANNED);
    assert.equal(m, null, f + ": " + (m && m[0]));
  }
});
