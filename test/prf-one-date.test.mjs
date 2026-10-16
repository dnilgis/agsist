/* PRF pages show search engines one date (Oct 16, 2026 head-to-head, issue 1),
 * and the county month table says its middle is per pair of months (issue 2).
 *
 * prf.html and prf/texas.html each carried a WebPage/WebApplication block
 * dated 2026-10-15 (the wording) and a Dataset block dated 2026-10-12 (USDA's
 * files). Now every JSON-LD block on a page carries the later of the two.
 *
 * The county table's "middle grid" is the median of the county's grids for
 * each pair of months, so Apr-May's middle need not be the grid in the dollar
 * example (Anderson County TX: grid 14538 is $18.80 per $100 at 90% for
 * Apr-May; the table's middle for that pair is $17.94).
 *
 *   node --test test/prf-one-date.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f) => readFileSync(ROOT + f, "utf8");
const dates = (h) => [...new Set([...h.matchAll(/"dateModified":\s*"([^"]+)"/g)].map((m) => m[1]))];

test("prf.html and every state and county page carry one dateModified", () => {
  const pages = ["prf.html"];
  for (const f of readdirSync(ROOT + "prf")) {
    if (f.endsWith(".html")) pages.push("prf/" + f);
    else if (existsSync(ROOT + "prf/" + f) && !f.includes(".")) for (const c of readdirSync(ROOT + "prf/" + f)) if (c.endsWith(".html")) pages.push(`prf/${f}/${c}`);
  }
  assert.ok(pages.length > 3000, `${pages.length} pages`);
  for (const p of pages) {
    const d = dates(read(p));
    assert.ok(d.length <= 1, `${p}: ${d.join(", ")}`);
  }
  assert.equal(dates(read("prf.html")).length, 1);
  assert.equal(dates(read("prf/texas.html")).length, 1);
  const ds = read("prf/texas.html").match(/"@type": ?"Dataset"[\s\S]*?"dateModified": ?"([^"]+)"/);
  assert.ok(ds, "the Texas page still has its Dataset block");
});

test("the county month table says the middle is per pair of months", () => {
  const h = read("prf/texas/anderson-county.html");
  assert.match(h, /across the 11 grids that touch the county: first the middle of the 11 for that pair of months \(it can be a different grid in each row\), then the lowest and highest/);
  assert.doesNotMatch(h, /the middle grid first/);
  // the two Apr-May figures the benchmark compared, both still on the page
  assert.match(h, /\$17\.94/);
  assert.match(h, /14538/);
  const st = read("prf/texas.html");
  assert.match(st, /Each figure is the middle of the grids for that pair of months/);
  const visible = h.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.doesNotMatch(visible, /—/);
});
