/* Curtain round 2 (Nov 9): every hail day page (scripts/generate_hail_events.py, a generated set) ends in one closed
 * "Sources and terms" fold, the same pattern as the hail map and state pages. Source, radar caveat, citation and byline
 * are inside it; no schedule, file name or radar product name is in the reading path; every figure stays.
 *   node --test test/hail-day-terms-fold.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FOLD = /<details[^>]*>\s*<summary>Sources and terms<\/summary>/g;
const BANNED = /\bMRMS\b|\bMESH\b|rebuil|refresh(es)? daily|vectorized|archive pull|poll|km grid|data\/hail|\.json|\.py\b|workflow|3:30/i;

const pages = JSON.parse(execFileSync("python3", ["-I", "-c", `
import sys, json; sys.path.insert(0, 'scripts')
import generate_hail_events as g
swath = g._new_rec("events-2024.json", "spc-12z"); swath["vintage"] = "2026-11-01"
for lat, lon, mag, st in ((31.74, -99.33, 3.0, "TX"), (35.2, -97.4, 1.25, "OK"), (35.3, -97.5, None, "OK")):
    g._add_report(swath, lat, lon, mag, st)
old = g._new_rec("events-2022.json", None); g._add_report(old, 41.1, -100.7, 1.75, "NE")
print(json.dumps({
  "swath": g.page_html("2024-05-21", swath, True, 2.62, "2026-11-09", None),
  "plain": g.page_html("2022-06-07", old, False, None, "2026-11-09", None),
  "radar_only": g.page_html("2025-06-01", None, True, 1.88, "2026-11-09", None),
}))`], { cwd: ROOT, encoding: "utf8" }));

const mainOf = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>"));
const reading = (m) => m.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "");

for (const [k, h] of Object.entries(pages)) {
  test(`hail day (${k}): exactly one closed Sources and terms fold, the last thing in main`, () => {
    const main = mainOf(h), f = main.match(FOLD) || [];
    assert.equal(f.length, 1);
    assert.ok(!/\sopen[\s>]/.test(f[0]), "closed");
    const end = main.indexOf("</details>", main.indexOf(f[0])) + "</details>".length;
    assert.equal(main.slice(end).replace(/<\/div>/g, "").trim(), "", "nothing after the fold");
    assert.ok(!/class="(he-src|he-how|method-note)"/.test(main), "old loose source line and method fold gone");
  });

  test(`hail day (${k}): source, citation and byline inside the fold; banned jargon absent everywhere`, () => {
    const main = mainOf(h), i = main.search(FOLD), fold = main.slice(i);
    assert.match(fold, /NWS Local Storm Reports via the Iowa Environmental Mesonet/);
    assert.match(fold, /Reuse and citation:<\/b> <em>AGSIST hail day, https:\/\/agsist\.com\/hail\/\d{4}-\d\d-\d\d \(NWS Local Storm Reports\)<\/em>/);
    assert.match(fold, /Compiled and reviewed by Sigurd Lindquist, CCA/);
    assert.match(fold, /rounded to about 1 km/, "the precision figure stays");
    const before = reading(main.slice(0, i));
    assert.ok(!/Local Storm Reports via the Iowa|Sigurd Lindquist/.test(before), "no credit block in the reading path");
    const m = reading(h.slice(h.indexOf("<head"))).match(BANNED);
    assert.equal(m, null, m && m[0]);
    assert.doesNotMatch(h, /—/, "no em dashes");
  });
}

test("hail day: the radar caveat sits in the fold on swath days, and the figures and dates stay", () => {
  for (const k of ["swath", "radar_only"]) {
    const fold = mainOf(pages[k]).slice(mainOf(pages[k]).search(FOLD));
    assert.match(fold, /radar estimates tend to run large against measured stones/, k);
    assert.match(fold, /Radar swaths are NOAA radar estimates of hail size/, k);
  }
  assert.doesNotMatch(pages.plain, /run large/, "no radar caveat where there is no radar");
  const s = pages.swath;
  assert.match(s, /as pulled 2026-11-01/, "the data date stays");
  assert.match(s, /<div class="v">2\.62″<\/div><div class="l">radar-estimated max/);
  assert.match(s, /<div class="v">3\.00″<\/div>/);
  assert.match(s, /A storm day runs 7 a\.m\. to 7 a\.m\. Central \(12:00 to 12:00 UTC\)/);
  assert.match(pages.plain, /grouped by UTC calendar day, 7 p\.m\. Central the evening before to 7 p\.m\. Central this day/);
  assert.match(pages.radar_only, /NOAA radar estimated hail up to 1\.88 inches that day/);
});
