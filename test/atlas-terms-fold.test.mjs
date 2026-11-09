/* Curtain round 2 (Nov 9): every Atlas county page ends in one closed "Sources and terms" fold (the old
 * "Sources, dates and arithmetic" fold, renamed and cut). The NASS notice, the AGSIST calculation line and the rank
 * sentence are inside it; no fit, formula, threshold or file wording is printed on the page.
 * node --test test/atlas-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const NASS = "This product uses the NASS API but is not endorsed or certified by NASS.";
const pages = [];
for (const st of readdirSync(ROOT + "farmland-atlas", { withFileTypes: true }))
  if (st.isDirectory() && !["states", "og", "data"].includes(st.name))
    for (const f of readdirSync(ROOT + "farmland-atlas/" + st.name)) if (f.endsWith(".html") && f !== "index.html") pages.push(`farmland-atlas/${st.name}/${f}`);
const live = pages.filter((p) => { const h = readFileSync(ROOT + p, "utf8"); return !h.includes('http-equiv="refresh"') && h.includes('class="ap ch"'); });
const FOLD_BANNED = /\bfitted\b|least.squares|divided by|\bD2\b|15 years|since 2008|\.json|\.py\b|workflow/i;   // the fold names sources, never how a figure is computed
const BANNED = /\bfitted\b|least.squares|divided by|15 years ending|needs \d+ published years|Rent per bushel is withheld here: it needs|Sources, dates and arithmetic|\.json|\.py\b|workflow/i;

test("every Atlas county page: one closed Sources and terms fold, last in the page body, notices inside", () => {
  assert.ok(live.length > 3000, "county pages: " + live.length);
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const folds = main.match(/<details[^>]*><summary>Sources and terms<\/summary>/g) || [];
    assert.equal(folds.length, 1, p + ": exactly one fold");
    assert.ok(!/\sopen[\s>]/.test(folds[0]), p + ": closed");
    const i = main.indexOf(folds[0]), e = main.indexOf("</details>", i);
    const fold = main.slice(i, e);
    assert.equal(main.slice(e + 10).trim(), "", p + ": the fold is the last thing in the page body");
    assert.ok(fold.includes(NASS) && /calculations by AGSIST/i.test(fold), p + ": notices inside");
    assert.ok(fold.includes("Rent ranks count every county with a published rent"), p);
    assert.match(fold, /USDA NASS Cash Rents Survey/, p);
    assert.equal(fold.replace(/<[^>]+>/g, " ").match(FOLD_BANNED), null, p + ": method wording in the fold");
    assert.ok(!main.slice(0, i).includes(NASS), p + ": NASS notice once, in the fold");
  }
});

test("no fit, formula, threshold or file wording on a county page", () => {
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const text = h.slice(h.indexOf("<body")).replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<noscript>[\s\S]*?<\/noscript>/g, "").replace(/<[^>]+>/g, " ");
    const m = text.match(BANNED);
    assert.equal(m, null, p + ": " + (m && m[0]));
  }
});

test("no link to a data file on a county page (Oct 29 rule: name the source in plain text)", () => {
  for (const p of live) {
    const h = readFileSync(ROOT + p, "utf8");
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    assert.ok(!/href="\/data\//.test(main.replace(/<script[\s\S]*?<\/script>/g, "")), p + ": links a data file");
  }
});
