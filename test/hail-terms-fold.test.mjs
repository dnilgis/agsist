/* Curtain round 2 (Nov 9): the hail map and the 51 state pages (built from scripts/generate_hail_states.py) each end in one
 * closed "Sources and terms" fold. Sources, known limits, credit and citation lines are inside it; no refresh schedule, job,
 * radar product or grid text is in the reading path.   node --test test/hail-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const FOLD = /<details[^>]*>\s*<summary>Sources and terms<\/summary>/g;
const BANNED = /rebuilds monthly|refreshes daily|refresh daily|vectorized|MRMS|~1\s?(&nbsp;)?km|every 90|3:30(&nbsp;)?AM|\.json|\.py\b|workflow/i;
const MESH = /\bMESH\b/;
const text = (h) => h.slice(h.indexOf("<main")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");

test("hail map: one closed fold at the bottom of the page body, credits inside it, loose method section gone", () => {
  const h = read("hail-map.html"), main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
  const f = main.match(FOLD) || [];
  assert.equal(f.length, 1);
  assert.ok(!/\sopen[\s>]/.test(f[0]));
  const i = main.indexOf(f[0]), fold = main.slice(i, main.indexOf("</details>", i));
  assert.ok(main.slice(main.indexOf("</details>", i) + 10).replace(/<p class="by-end"[\s\S]*$/, "").replace(/<\/div>/g, "").trim() === "", "last thing before the byline");
  assert.match(fold, /Local Storm Reports via the Iowa Environmental Mesonet/);
  assert.match(fold, /NOAA NCEI Storm Events Database, 1955 to 2020, never mixed with the current record/);
  assert.match(fold, /Radar estimates tend to run large against measured stones, so every swath here is labeled an estimate/);
  assert.match(fold, /Storm reports are town-level precision and depend on someone reporting/);
  assert.match(fold, /NWS\/NOAA data via agsist\.com\/hail-map/);
  assert.match(fold, /Questions, corrections, press: <a href="mailto:sig@agsist\.com">/);
  assert.ok(!main.includes('id="hm-method-h"') && !main.includes("Data &amp; cadence"));
  const m = text(h).replace(/<section class="hm-faq"[\s\S]*?(?=<p class="rp-promo")/, "").match(BANNED);   // the questions are search text and are left alone
  assert.equal(m, null, m && m[0]);
  assert.ok(!MESH.test(text(h).replace(/<section class="hm-faq"[\s\S]*?(?=<p class="rp-promo")/, "")));
});

test("hail map: the source line under the map is one line and the lede carries no schedule", () => {
  const h = read("hail-map.html");
  assert.match(h, /<div class="hm-src">Source: NWS Local Storm Reports via the Iowa Environmental Mesonet\. <span id="hm-gen">/);
  assert.match(read("scripts/seed_static.py"), /\+ "\."\) if yrs else None/);
});

test("state pages: the builder ends every page in one closed fold with the source, the citation and the byline", () => {
  const rows = [{ county: "Dane", total: 190, avg: 38.0, peak: "Apr", dmg_pct: 39 }];
  const out = execFileSync("python3", ["-I", "-c", "import sys; sys.path.insert(0, 'scripts'); import generate_hail_states as g; " +
    "sys.stdout.write(g.page_html('WI', 'Wisconsin', " + JSON.stringify(rows).replace(/null/g, "None") + ", [2022, 2023, 2024, 2025, 2026], 1.0, '2026-10-10', 4.75, []))"],
    { cwd: ROOT, encoding: "utf8" });
  const main = out.slice(out.indexOf("<main"), out.indexOf("</main>"));
  const f = main.match(FOLD) || [];
  assert.equal(f.length, 1);
  const i = main.indexOf(f[0]), fold = main.slice(i, main.indexOf("</details>", i));
  assert.match(fold, /Source: National Weather Service Local Storm Reports via the Iowa Environmental Mesonet, 2022–2026/);
  assert.match(fold, /population and spotter density bias the counts/);
  assert.match(fold, /To cite these figures: <em>AGSIST National Hail Map, https:\/\/agsist\.com\/hail-map\/wisconsin/);
  assert.match(fold, /Compiled by Sigurd Lindquist/);
  assert.ok(!main.includes('class="hs-src"') && !main.includes('class="hs-cite"'));
  assert.ok(main.indexOf('data-rain-print-promo="auto"') > i, "the promo line stays after the fold");
  const m = text(out).match(BANNED);
  assert.equal(m, null, m && m[0]);
});
