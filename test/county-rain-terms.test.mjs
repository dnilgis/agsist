/* Curtain round 2 (Nov 9): every county rain page and state rain page ends in one closed "Sources and terms" fold,
 * with the NOAA and RCC-ACIS credit inside, and publishes no pick order, station ID, gauge reading habit or
 * threshold. node --test test/county-rain-terms.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const pages = [];
for (const f of readdirSync(ROOT + "rain")) {
  if (f.endsWith(".html") && f !== "index.html") pages.push("rain/" + f);
  else if (existsSync(ROOT + "rain/" + f) && !f.includes(".")) for (const g of readdirSync(ROOT + "rain/" + f)) if (g.endsWith(".html")) pages.push(`rain/${f}/${g}`);
}
const real = (p) => !readFileSync(ROOT + p, "utf8").includes('http-equiv="refresh"');   // a county that lost its station is a pointer page
const live = pages.filter(real);
const BANNED = /usually in the morning|read once a day|\(?(gauge|station) ID\b|stations? far above the rest|The pick goes|full record of both rain and snowfall|under 40%|at least 90%|\bleast.squares\b/i;

test("every county and state rain page: one closed fold, last, credit inside", () => {
  assert.ok(live.length > 2000, "pages found: " + live.length);
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(folds.length, 1, p);
    assert.ok(!/\sopen[ >]/.test(folds[0]), p + " closed");
    const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
    const fold = main.slice(i, e);
    assert.match(fold, /NOAA/, p);
    assert.match(fold, /RCC-ACIS/, p);
    assert.ok(!main.slice(e + 10).includes("<details") && !main.slice(0, i).includes("RCC-ACIS"), p + " last, credit once");
  }
});

test("no pick order, station ID, reading habit or threshold on a rain page", () => {
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const text = h.slice(h.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");
    const m = text.match(BANNED);
    assert.equal(m, null, p + ": " + (m && m[0]));
  }
});
